import type { Quantity } from './recipe.ts';

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.trunc(a));
  let y = Math.abs(Math.trunc(b));
  while (y !== 0) {
    [x, y] = [y, x % y];
  }
  return x === 0 ? 1 : x;
}

export function snap(value: number, step: number): number {
  if (step <= 0) throw new Error('step must be positive');
  return Math.round(value / step) * step;
}

export type NiceFraction = {
  whole: number;
  numerator: number;
  denominator: number;
};

export function niceFraction(value: number, denom: 8 | 4 | 2 = 8): NiceFraction {
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  const total = Math.round(abs * denom);
  const whole = Math.floor(total / denom);
  const num = total - whole * denom;
  if (num === 0) {
    return { whole: sign * whole, numerator: 0, denominator: denom };
  }
  const g = gcd(num, denom);
  // When there is no whole part, carry the sign on the numerator so a pure
  // negative fraction (e.g. -1/2) round-trips through formatFraction without
  // losing its sign.
  const reducedNum = num / g;
  return {
    whole: sign * whole,
    numerator: whole === 0 ? sign * reducedNum : reducedNum,
    denominator: denom / g,
  };
}

export function formatFraction(f: NiceFraction): string {
  if (f.numerator === 0) return String(f.whole);
  // The sign lives on `whole` for mixed numbers, or on `numerator` when there
  // is no whole part (e.g. "-1 1/2" vs "-1/2").
  if (f.whole === 0) return `${f.numerator}/${f.denominator}`;
  return `${f.whole} ${f.numerator}/${f.denominator}`;
}

/**
 * Format an exact stored fraction (numerator/denominator) as a reduced mixed
 * number, honoring whatever the user entered — e.g. 1/3 → "1/3", 5/8 → "5/8",
 * 7/3 → "2 1/3". Unlike niceFraction this does NOT snap to eighths, so
 * non-eighth fractions like thirds survive display. Denominator is assumed
 * positive (per the Quantity schema).
 */
export function formatExactFraction(numerator: number, denominator: number): string {
  if (denominator === 0) return String(numerator);
  const sign = numerator < 0 ? -1 : 1;
  const num = Math.abs(numerator);
  const den = Math.abs(denominator);
  const whole = Math.floor(num / den);
  const rem = num - whole * den;
  if (rem === 0) return String(sign * whole);
  const g = gcd(rem, den);
  return formatFraction({
    whole: sign * whole,
    numerator: whole === 0 ? sign * (rem / g) : rem / g,
    denominator: den / g,
  });
}

/**
 * Snap a quantity to a sensible display step for the given unit, per doc 06.
 * Returns the snapped numeric value (in the same unit). Callers that want a
 * mixed-number rendering should pass the result through niceFraction.
 */
export function niceQuantity(value: number, unit: string | null | undefined): number {
  if (!Number.isFinite(value)) return value;
  if (unit == null) {
    return value >= 1 ? Math.round(value) : Math.round(value * 10) / 10;
  }
  switch (unit) {
    case 'tsp':
    case 'tbsp':
    case 'cup_us':
    case 'cup_metric':
      return snap(value, 1 / 8);
    case 'oz':
    case 'lb':
      return snap(value, 1 / 8);
    case 'ml':
      if (value < 100) return snap(value, 5);
      if (value < 1000) return snap(value, 25);
      return snap(value, 50);
    case 'l':
      return snap(value, 0.05);
    case 'g':
      if (value < 100) return snap(value, 5);
      if (value < 1000) return snap(value, 25);
      return snap(value, 50);
    case 'kg':
      return snap(value, 0.05);
    case 'count':
      return value >= 1 ? Math.round(value) : Math.round(value * 10) / 10;
    case 'min':
      return value >= 5 ? snap(value, 5) : Math.round(value);
    case 'h':
      return snap(value, 0.25);
    case 'C':
    case 'F':
      return snap(value, 5);
    default:
      return value;
  }
}

/** Hide fractions on quantities >= 10 to reduce clutter ("12 g flour"). */
export function shouldHideFraction(value: number): boolean {
  return Math.abs(value) >= 10;
}

/**
 * Units cooks naturally read as fractions ("1 1/2 cup", "1/8 tsp"). Mass in
 * grams / volume in millilitres etc. read better as plain decimals.
 */
const FRACTION_FRIENDLY_UNITS = new Set([
  'tsp',
  'tbsp',
  'cup_us',
  'cup_metric',
  'oz',
  'lb',
  'count',
]);

export function isFractionFriendlyUnit(unit: string | null | undefined): boolean {
  return unit != null && FRACTION_FRIENDLY_UNITS.has(unit);
}

/**
 * Render a quantity for a given unit. An exact stored fraction (numerator/
 * denominator) is honored verbatim for any unit — including grams/ml and
 * unitless — so a value the user typed as "1/3" or "5/8" shows as that
 * fraction rather than being snapped to eighths or shown as a decimal. Plain
 * numbers choose a mixed-number fraction for fraction-friendly cooking units
 * and a decimal otherwise; values >= 10 drop the fraction part to reduce
 * clutter. The numeric `formatDecimal` is injected so this module stays pure
 * and free of locale concerns. Per docs/06 display pipeline.
 */
export function formatDisplayQuantity(
  value: Quantity,
  unit: string | null | undefined,
  formatDecimal: (value: number) => string,
): string {
  if (typeof value === 'object') {
    return formatExactFraction(value.numerator, value.denominator);
  }
  if (!Number.isFinite(value)) return formatDecimal(value);
  if (isFractionFriendlyUnit(unit) && !shouldHideFraction(value)) {
    return formatFraction(niceFraction(value, 8));
  }
  return formatDecimal(value);
}
