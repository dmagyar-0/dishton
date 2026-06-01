import { assert, assertEquals } from '@std/assert';
import { costUsd, fmtUsd, priceFor } from './cost.ts';

Deno.test('priceFor matches exact and prefixed model ids', () => {
  assertEquals(priceFor('claude-opus-4-8')?.output, 25);
  assertEquals(priceFor('claude-haiku-4-5-20251001')?.input, 1);
  assertEquals(priceFor('something-else'), null);
});

Deno.test('costUsd: cache read 0.1x, write 1.25x, output at full rate', () => {
  // haiku: $1/M in, $5/M out
  const c = costUsd('claude-haiku-4-5', {
    input: 1_000_000,
    output: 1_000_000,
    cacheRead: 1_000_000,
    cacheWrite: 1_000_000,
  });
  // input side: (1 + 0.1 + 1.25) * $1 = $2.35 ; output: 1 * $5 = $5 → $7.35
  assertEquals(Number(c!.toFixed(2)), 7.35);
});

Deno.test('costUsd: null for unknown model', () => {
  assertEquals(costUsd('mystery', { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }), null);
});

Deno.test('fmtUsd formats small and large', () => {
  assertEquals(fmtUsd(null), '—');
  assert(fmtUsd(0.0012).startsWith('$0.0012'));
  assertEquals(fmtUsd(0.5), '$0.500');
});
