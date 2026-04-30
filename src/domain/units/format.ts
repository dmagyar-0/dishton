import type { Bcp47 } from '../recipe.ts';
import { units } from './graph.ts';

/** Symbol of a unit, optionally locale-aware. Falls back to English. */
export function formatUnit(key: string, locale: Bcp47 | string = 'en'): string {
  const def = units[key];
  if (!def) return key;
  const lang = (locale ?? 'en').slice(0, 2).toLowerCase() as 'en' | 'de' | 'fr' | 'it' | 'es';
  const candidate = def.symbol[lang];
  return candidate ?? def.symbol.en;
}

/** Render a numeric value with at most `frac` decimals, dropping trailing zeros. */
export function formatNumber(value: number, frac = 2): string {
  if (!Number.isFinite(value)) return String(value);
  const rounded = Number(value.toFixed(frac));
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

/** Combined "qty unit" display, with a single space separator. */
export function formatQuantity(value: number, unit: string, locale: Bcp47 | string = 'en'): string {
  return `${formatNumber(value)} ${formatUnit(unit, locale)}`;
}
