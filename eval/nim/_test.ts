import { assertEquals, assertThrows } from '@std/assert';
import { EvalConfigSchema, config } from './models.ts';

Deno.test('models: default config parses', () => {
  const parsed = EvalConfigSchema.parse(config);
  assertEquals(parsed.candidates.length >= 1, true);
  assertEquals(typeof parsed.concurrency, 'number');
  assertEquals(typeof parsed.repeat, 'number');
  assertEquals(typeof parsed.timeoutMs, 'number');
});

Deno.test('models: rejects empty candidates', () => {
  assertThrows(() =>
    EvalConfigSchema.parse({
      candidates: [],
      concurrency: 2,
      repeat: 1,
      timeoutMs: 90_000,
    })
  );
});

Deno.test('models: rejects non-positive concurrency', () => {
  assertThrows(() =>
    EvalConfigSchema.parse({
      candidates: [{ id: 'x' }],
      concurrency: 0,
      repeat: 1,
      timeoutMs: 90_000,
    })
  );
});
