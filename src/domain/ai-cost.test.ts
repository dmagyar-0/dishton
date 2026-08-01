import { describe, expect, it } from 'vitest';
import { AiModelPrice, ZERO_PRICE, formatUsd, usdForUsage } from './ai-cost';

const sonnet: AiModelPrice = {
  model: 'claude-sonnet-5',
  input_usd_per_mtok: 3,
  output_usd_per_mtok: 15,
  cache_read_usd_per_mtok: 0.3,
  cache_write_usd_per_mtok: 3.75,
};

describe('AiModelPrice', () => {
  it('accepts a well-formed price row', () => {
    expect(AiModelPrice.parse(sonnet)).toEqual(sonnet);
  });
  it('rejects a negative rate', () => {
    expect(() => AiModelPrice.parse({ ...sonnet, input_usd_per_mtok: -1 })).toThrow();
  });
  it('rejects an empty model name', () => {
    expect(() => AiModelPrice.parse({ ...sonnet, model: '' })).toThrow();
  });
});

describe('usdForUsage', () => {
  it('zero usage costs $0 regardless of price', () => {
    const usd = usdForUsage({ tokens_in: 0, tokens_out: 0, cache_read: 0, cache_write: 0 }, sonnet);
    expect(usd).toBe(0);
  });

  it('an unknown/zero-priced model costs $0 even with real usage', () => {
    const usd = usdForUsage(
      { tokens_in: 100_000, tokens_out: 50_000, cache_read: 10_000, cache_write: 5_000 },
      ZERO_PRICE,
    );
    expect(usd).toBe(0);
  });

  it('computes input+output cost for a typical (uncached) call', () => {
    // 1,000 input + 500 output tokens at sonnet-5 rates:
    // (1000*3 + 500*15) / 1e6 = (3000 + 7500) / 1e6 = 0.0105
    const usd = usdForUsage(
      { tokens_in: 1000, tokens_out: 500, cache_read: 0, cache_write: 0 },
      sonnet,
    );
    expect(usd).toBeCloseTo(0.0105, 10);
  });

  it('accounts for cache-heavy usage (large cache_read, some cache_write)', () => {
    const usage = { tokens_in: 200, tokens_out: 100, cache_read: 50_000, cache_write: 8_000 };
    const usd = usdForUsage(usage, sonnet);
    const expected =
      (usage.tokens_in * sonnet.input_usd_per_mtok +
        usage.tokens_out * sonnet.output_usd_per_mtok +
        usage.cache_read * sonnet.cache_read_usd_per_mtok +
        usage.cache_write * sonnet.cache_write_usd_per_mtok) /
      1_000_000;
    expect(usd).toBeCloseTo(expected, 10);
    // Cache reads are 10x cheaper than a fresh input token, so a cache-heavy
    // call should cost noticeably less than treating cache_read as tokens_in.
    const asIfUncached = usdForUsage(
      { tokens_in: usage.cache_read, tokens_out: 0, cache_read: 0, cache_write: 0 },
      sonnet,
    );
    expect(usd).toBeLessThan(asIfUncached);
  });

  it('handles a non-integer result without floating-point drift beyond double precision', () => {
    // 1,000,000 tokens at $1/mtok is an exact $1 -- sanity-checks the /1e6 step.
    const haiku: AiModelPrice = {
      model: 'claude-haiku-4-5',
      input_usd_per_mtok: 1,
      output_usd_per_mtok: 5,
      cache_read_usd_per_mtok: 0.1,
      cache_write_usd_per_mtok: 1.25,
    };
    const usd = usdForUsage(
      { tokens_in: 1_000_000, tokens_out: 0, cache_read: 0, cache_write: 0 },
      haiku,
    );
    expect(usd).toBe(1);
  });
});

describe('formatUsd', () => {
  it('formats zero as $0.00', () => {
    expect(formatUsd(0)).toBe('$0.00');
  });

  it('formats a sub-cent single-import cost with extra precision', () => {
    // A realistic import: a few thousand tokens on Haiku lands around this.
    expect(formatUsd(0.0045)).toBe('$0.0045');
  });

  it('formats amounts at or above one cent with two decimal places', () => {
    expect(formatUsd(0.01)).toBe('$0.01');
    expect(formatUsd(1.5)).toBe('$1.50');
    expect(formatUsd(12.3)).toBe('$12.30');
  });

  it('never throws and never shows a negative amount for bad input', () => {
    expect(formatUsd(-1)).toBe('$0.00');
    expect(formatUsd(Number.NaN)).toBe('$0.00');
    expect(formatUsd(Number.POSITIVE_INFINITY)).toBe('$0.00');
  });
});
