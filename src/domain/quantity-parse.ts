import { formatFraction, niceFraction, shouldHideFraction } from './fractions';
import type { Quantity } from './recipe';

export type ParsedQuantity = { ok: true; value: Quantity | null } | { ok: false; error: 'invalid' };

const MIXED_FRACTION_RE = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/;
const FRACTION_RE = /^(\d+)\s*\/\s*(\d+)$/;
const DECIMAL_RE = /^(\d+)(?:\.(\d+))?$/;

// Parses user input from a single quantity text field.
// Accepts: "" or "0" → null/0, decimals like "1.5", fractions like "1/2",
// mixed numbers like "1 1/2". Returns a Quantity that the Recipe schema
// accepts (either a number or {numerator, denominator}). Mixed fractions
// collapse to a single numerator/denominator (e.g. 1 1/2 → 3/2).
export function parseQuantityInput(raw: string): ParsedQuantity {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true, value: null };

  const mixed = MIXED_FRACTION_RE.exec(trimmed);
  if (mixed) {
    const whole = Number(mixed[1]);
    const num = Number(mixed[2]);
    const den = Number(mixed[3]);
    if (!Number.isFinite(whole) || !Number.isFinite(num) || !Number.isFinite(den) || den === 0) {
      return { ok: false, error: 'invalid' };
    }
    const numerator = whole * den + num;
    return { ok: true, value: { numerator, denominator: den } };
  }

  const fraction = FRACTION_RE.exec(trimmed);
  if (fraction) {
    const num = Number(fraction[1]);
    const den = Number(fraction[2]);
    if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) {
      return { ok: false, error: 'invalid' };
    }
    return { ok: true, value: { numerator: num, denominator: den } };
  }

  const decimal = DECIMAL_RE.exec(trimmed);
  if (decimal) {
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return { ok: false, error: 'invalid' };
    return { ok: true, value: n };
  }

  return { ok: false, error: 'invalid' };
}

// Turns a stored Quantity back into a text the user can edit.
// Whole numbers and large decimals stay as plain numbers; small non-integers
// render as mixed fractions ("1 1/2") matching how the rest of the app
// formats quantities for display.
export function formatQuantityForInput(q: Quantity | null): string {
  if (q === null) return '';
  if (typeof q === 'object') {
    if (q.denominator === 1) return String(q.numerator);
    return formatFraction(niceFraction(q.numerator / q.denominator, 8));
  }
  if (Number.isInteger(q)) return String(q);
  if (shouldHideFraction(q)) return String(q);
  return formatFraction(niceFraction(q, 8));
}
