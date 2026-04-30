/**
 * Normalise an arbitrary BCP-47-ish input to one of the two forms the DB
 * accepts: "xx" or "xx-YY". Returns null for inputs that cannot be coerced.
 */
export function normaliseBcp47(input: string | null | undefined): string | null {
  if (input == null) return null;
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const m = /^([A-Za-z]{2})(?:[-_]([A-Za-z]{2}))?$/.exec(trimmed);
  if (!m) return null;
  const lang = (m[1] ?? '').toLowerCase();
  const region = m[2];
  return region ? `${lang}-${region.toUpperCase()}` : lang;
}

/**
 * Build the display-language fallback chain.
 *   "fr-CA" -> ["fr-CA", "fr", "en"]
 *   "pt-BR" -> ["pt-BR", "pt", "en"]
 *   "en"    -> ["en"]
 */
export function languageFallbackChain(input: string): string[] {
  const norm = normaliseBcp47(input);
  if (norm === null) return ['en'];
  const out: string[] = [norm];
  if (norm.includes('-')) {
    const base = norm.split('-')[0];
    if (base) out.push(base);
  }
  if (!out.includes('en')) out.push('en');
  return out;
}
