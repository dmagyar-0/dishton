// USD cost model for round-2 candidates. Prices are per 1M tokens, from the
// claude-api skill catalog (cached 2026-05-26). Cache reads bill at ~0.1x and
// 5-minute cache writes at ~1.25x the input price; output includes thinking
// tokens.

export type Usage = {
  input: number; // uncached input tokens
  output: number; // output tokens (includes adaptive-thinking tokens)
  cacheRead: number;
  cacheWrite: number;
};

export type Price = { input: number; output: number };

export const PRICES: Record<string, Price> = {
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-opus-4-8': { input: 5.0, output: 25.0 },
};

const CACHE_READ_MULT = 0.1;
const CACHE_WRITE_MULT = 1.25; // 5-minute TTL

export function priceFor(model: string): Price | null {
  if (PRICES[model]) return PRICES[model]!;
  for (const [k, v] of Object.entries(PRICES)) {
    if (model.startsWith(k)) return v;
  }
  return null;
}

/** Cost of a single call in USD, or null if the model price is unknown. */
export function costUsd(model: string, usage: Usage): number | null {
  const p = priceFor(model);
  if (!p) return null;
  const inTok = usage.input +
    usage.cacheRead * CACHE_READ_MULT +
    usage.cacheWrite * CACHE_WRITE_MULT;
  return (inTok * p.input + usage.output * p.output) / 1_000_000;
}

export function fmtUsd(n: number | null): string {
  if (n === null) return '—';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(3)}`;
}
