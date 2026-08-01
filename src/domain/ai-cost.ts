// USD cost accounting for Anthropic API usage.
//
// Prices come from app.ai_model_prices (see
// supabase/migrations/20260801120000_product_metrics.sql) -- pricing is data,
// not code, so this module never hardcodes a rate table. It only knows how to
// turn a (usage, price) pair into a dollar amount and how to display one.
// Pure, no I/O: callers fetch the price row (an Edge Function, an admin RPC
// result) and hand it in.

import { z } from 'zod';

// One row of app.ai_model_prices, validated at the boundary (Edge Function /
// admin RPC response) before any arithmetic runs on it.
export const AiModelPrice = z.object({
  model: z.string().min(1),
  input_usd_per_mtok: z.number().nonnegative(),
  output_usd_per_mtok: z.number().nonnegative(),
  cache_read_usd_per_mtok: z.number().nonnegative(),
  cache_write_usd_per_mtok: z.number().nonnegative(),
});
export type AiModelPrice = z.infer<typeof AiModelPrice>;

// A model with no matching app.ai_model_prices row (a new/renamed model that
// hasn't been priced yet) costs $0 here -- callers must surface that as an
// "unpriced calls" count (see app.metrics_ai_cost) rather than treating the
// $0 result as a real cost.
export const ZERO_PRICE: AiModelPrice = {
  model: '(unpriced)',
  input_usd_per_mtok: 0,
  output_usd_per_mtok: 0,
  cache_read_usd_per_mtok: 0,
  cache_write_usd_per_mtok: 0,
};

export type AiUsage = {
  tokens_in: number;
  tokens_out: number;
  cache_read: number;
  cache_write: number;
};

// Rates in app.ai_model_prices are USD per million tokens ("mtok"), matching
// the Anthropic pricing page. usage * rate / 1e6 gives USD for that usage.
const TOKENS_PER_MTOK = 1_000_000;

export function usdForUsage(usage: AiUsage, price: AiModelPrice): number {
  const total =
    usage.tokens_in * price.input_usd_per_mtok +
    usage.tokens_out * price.output_usd_per_mtok +
    usage.cache_read * price.cache_read_usd_per_mtok +
    usage.cache_write * price.cache_write_usd_per_mtok;
  return total / TOKENS_PER_MTOK;
}

// Display formatting for a USD amount. A single recipe import typically costs
// a fraction of a cent, so amounts below one cent get extra precision (4dp)
// instead of always rounding down to the useless "$0.00" that toFixed(2)
// would produce.
export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return '$0.00';
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}
