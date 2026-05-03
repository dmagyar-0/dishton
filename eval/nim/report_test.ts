import { assertEquals } from '@std/assert';
import { aggregate, percentile, type RunResults, writeMarkdown } from './report.ts';

Deno.test('report: percentile p50 of [1,2,3] is 2', () => {
  assertEquals(percentile([1, 2, 3], 50), 2);
});

Deno.test('report: percentile p95 of [10..100] linearly interpolates to 95.5', () => {
  assertEquals(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 95), 95.5);
});

Deno.test('report: percentile of empty list is null', () => {
  assertEquals(percentile([], 50), null);
});

Deno.test('report: aggregate computes per-model metrics', () => {
  const results: RunResults = {
    startedAt: '2026-05-03T14:00:00.000Z',
    finishedAt: '2026-05-03T14:01:00.000Z',
    config: {
      models: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      concurrency: 2,
      repeat: 1,
      timeoutMs: 90_000,
    },
    urls: [
      {
        url: 'https://x/1',
        sourceExcerpt: 'src',
        readabilityUsed: true,
        outcomes: [
          { url: 'https://x/1', model: 'a', schemaOk: true, latencyMs: 100, tokensIn: 1000, tokensOut: 200, raw: '{}' },
          { url: 'https://x/1', model: 'b', schemaOk: false, latencyMs: 200, tokensIn: 1000, tokensOut: 50, raw: 'oops', error: 'parse' },
        ],
      },
      {
        url: 'https://x/2',
        sourceExcerpt: 'src',
        readabilityUsed: true,
        outcomes: [
          { url: 'https://x/2', model: 'a', schemaOk: true, latencyMs: 300, tokensIn: 1000, tokensOut: 200, raw: '{}' },
          { url: 'https://x/2', model: 'b', schemaOk: true, latencyMs: 400, tokensIn: 1000, tokensOut: 200, raw: '{}' },
        ],
      },
    ],
    skippedUrls: [],
  };
  const agg = aggregate(results);
  const a = agg.find((r) => r.model === 'a')!;
  const b = agg.find((r) => r.model === 'b')!;
  assertEquals(a.schemaOk, '2/2');
  assertEquals(b.schemaOk, '1/2');
  assertEquals(a.errors.length, 0);
  assertEquals(b.errors[0], 'parse');
  assertEquals(a.p50Ms, 200); // median of [100, 300]
});

Deno.test('report: writeMarkdown emits required sections and TBD placeholders', async () => {
  const results: RunResults = {
    startedAt: '2026-05-03T14:00:00.000Z',
    finishedAt: '2026-05-03T14:01:00.000Z',
    config: {
      models: [{ id: 'm1', label: 'M1' }],
      concurrency: 2,
      repeat: 1,
      timeoutMs: 90_000,
    },
    urls: [
      {
        url: 'https://example.com/r',
        sourceExcerpt: 'cleaned source text excerpt',
        readabilityUsed: true,
        outcomes: [
          {
            url: 'https://example.com/r',
            model: 'm1',
            modelLabel: 'M1',
            schemaOk: true,
            latencyMs: 1234,
            tokensIn: 500,
            tokensOut: 100,
            raw: '{"title":"x"}',
          },
        ],
      },
    ],
    skippedUrls: [{ url: 'https://bad/x', reason: 'fetch_failed' }],
  };
  const dir = await Deno.makeTempDir();
  const path = `${dir}/out.md`;
  await writeMarkdown(results, path);
  const content = await Deno.readTextFile(path);
  assertEquals(content.includes('## Leaderboard'), true);
  assertEquals(content.includes('## Run config'), true);
  assertEquals(content.includes('## Per-URL results'), true);
  assertEquals(content.includes('## Skipped URLs'), true);
  assertEquals(content.includes('https://example.com/r'), true);
  assertEquals(content.includes('cleaned source text excerpt'), true);
  assertEquals(content.includes('Completeness: TBD'), true);
  assertEquals(content.includes('Fidelity: TBD'), true);
  assertEquals(content.includes('Format hygiene: TBD'), true);
  assertEquals(content.includes('Overall: TBD'), true);
  assertEquals(content.includes('Notes: TBD'), true);
  assertEquals(content.includes('https://bad/x'), true);
});
