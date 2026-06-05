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
 * Render a numeric quantity for a given unit, choosing a mixed-number fraction
 * for fraction-friendly cooking units and a plain decimal otherwise. Large
 * values (>= 10) drop the fraction part to reduce clutter even for friendly
 * units. The numeric `formatDecimal` is injected so this module stays pure and
 * free of locale concerns. Per docs/06 display pipeline.
 */
export function formatDisplayQuantity(
  value: number,
  unit: string | null | undefined,
  formatDecimal: (value: number) => string,
): string {
  if (!Number.isFinite(value)) return formatDecimal(value);
  if (isFractionFriendlyUnit(unit) && !shouldHideFraction(value)) {
    return formatFraction(niceFraction(value, 8));
  }
  return formatDecimal(value);
}
