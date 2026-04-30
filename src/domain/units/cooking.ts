// Cooking-specific aliases used by the parser and the prompt schema. These
// are not extra units (those live in graph.ts) but rather mappings from
// free-text tokens to canonical keys, with locale-aware defaults for "cup".

import type { Bcp47 } from '../recipe.ts';

const EUROPEAN_LANGUAGES = new Set([
  'de',
  'fr',
  'it',
  'es',
  'pt',
  'sv',
  'no',
  'fi',
  'nl',
  'da',
  'pl',
  'cs',
  'sk',
  'hu',
  'ro',
  'hr',
  'sl',
  'el',
  'is',
]);

const ALWAYS: Record<string, string> = {
  g: 'g',
  gram: 'g',
  grams: 'g',
  gramm: 'g',
  gr: 'g',
  kg: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  oz: 'oz',
  ounce: 'oz',
  ounces: 'oz',
  lb: 'lb',
  lbs: 'lb',
  pound: 'lb',
  pounds: 'lb',
  ml: 'ml',
  milliliter: 'ml',
  milliliters: 'ml',
  millilitre: 'ml',
  millilitres: 'ml',
  l: 'l',
  liter: 'l',
  liters: 'l',
  litre: 'l',
  litres: 'l',
  tsp: 'tsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  tbsp: 'tbsp',
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  'fl oz': 'fl_oz',
  'fl. oz.': 'fl_oz',
  fluidounce: 'fl_oz',
  pint: 'pint_us',
  pints: 'pint_us',
  pt: 'pint_us',
  qt: 'quart_us',
  quart: 'quart_us',
  quarts: 'quart_us',
  '°c': 'C',
  '°f': 'F',
  c: 'C',
  f: 'F',
  min: 'min',
  minute: 'min',
  minutes: 'min',
  h: 'h',
  hr: 'h',
  hour: 'h',
  hours: 'h',
};

const STICK_OF_BUTTER_G = 113;

/**
 * Resolve a free-text unit token to its canonical unit-graph key.
 * `sourceLanguage` resolves "cup" / "tasse" / "kop" ambiguity:
 * European-language sources use cup_metric (250 ml); other sources default
 * to cup_us (240 ml).
 */
export function resolveUnitToken(
  token: string,
  sourceLanguage: Bcp47 | undefined = 'en',
): string | null {
  const norm = token.trim().toLowerCase();
  if (norm === '') return null;
  if (
    norm === 'cup' ||
    norm === 'cups' ||
    norm === 'tasse' ||
    norm === 'kop' ||
    norm === 'kopjes'
  ) {
    const lang = (sourceLanguage ?? 'en').slice(0, 2).toLowerCase();
    return EUROPEAN_LANGUAGES.has(lang) ? 'cup_metric' : 'cup_us';
  }
  return ALWAYS[norm] ?? null;
}

/** "1 stick of butter" -> 113 g, returned as { qty, unit }. */
export function stickOfButterToGrams(sticks: number): { qty: number; unit: 'g' } {
  return { qty: sticks * STICK_OF_BUTTER_G, unit: 'g' };
}
