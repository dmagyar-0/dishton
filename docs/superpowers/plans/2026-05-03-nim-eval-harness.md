# NIM Evaluation Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Deno CLI under `eval/nim/` that runs a curated list of recipe URLs through every candidate NIM model using the production `structuringFromHtml` prompt, captures latency and schema-pass-rate automatically, and writes a Markdown report with judge-score placeholders that the active Claude Code session fills in interactively.

**Architecture:** A small set of focused modules (config, fetch, NIM client, report, orchestrator) under `eval/nim/`. Reuses production prompts and the `Recipe` Zod schema by direct import, with no copy-paste. Bypasses Supabase, `import_jobs`, and `withRateBudget` — strictly a developer tool. Models compete head-to-head on identical cleaned input per URL.

**Tech Stack:** Deno (matches edge functions), TypeScript, Zod (config validation), `@mozilla/readability` + `linkedom` (HTML extraction, mirrors `import-url`), `jsr:@std/assert` for tests.

**Spec:** [`docs/superpowers/specs/2026-05-03-nim-eval-harness-design.md`](../specs/2026-05-03-nim-eval-harness-design.md)

---

## File map

Create:
- `eval/nim/deno.json` — local Deno config (import map for `zod`)
- `eval/nim/models.ts` — config types and the candidate list
- `eval/nim/fetch.ts` — fetch URL + Readability extract → cleaned text
- `eval/nim/client.ts` — minimal NIM caller (no retry, returns latency + raw)
- `eval/nim/report.ts` — `renderConsole` + `writeMarkdown`
- `eval/nim/run.ts` — orchestrator and CLI entry point
- `eval/nim/_test.ts` — Deno tests for `fetch.extractFromHtml`, `client.callNim`, `report.renderConsole`, `report.writeMarkdown`
- `eval/nim/urls.txt.example` — committed sample list
- `eval/nim/README.md` — short usage doc

Modify:
- `.gitignore` — add `eval/nim/urls.txt` and `eval/nim/runs/`
- `package.json` — add `eval:nim` and `test:eval` scripts

---

## Task 1: Scaffolding (directories, gitignore, deno.json, package scripts)

**Files:**
- Create: `eval/nim/deno.json`
- Create: `eval/nim/urls.txt.example`
- Create: `eval/nim/README.md`
- Modify: `.gitignore`
- Modify: `package.json`

This task has no tests — it is pure scaffolding. We commit it so the rest of the work has a stable foundation.

- [ ] **Step 1: Create directories**

```bash
mkdir -p eval/nim/runs
```

- [ ] **Step 2: Create `eval/nim/deno.json`**

```json
{
  "imports": {
    "zod": "npm:zod@^3",
    "@std/assert": "jsr:@std/assert@^1",
    "@mozilla/readability": "npm:@mozilla/readability@0.5",
    "linkedom": "npm:linkedom@0.18"
  },
  "lock": false,
  "nodeModulesDir": false
}
```

- [ ] **Step 3: Create `eval/nim/urls.txt.example`**

```
# One recipe URL per line. Lines starting with `#` and blank lines are skipped.
# Copy this file to urls.txt (gitignored) and populate it.
# Example:
# https://www.bbcgoodfood.com/recipes/easy-chocolate-cake
# https://smittenkitchen.com/2018/03/dijon-and-cognac-beef-stew/
```

- [ ] **Step 4: Create `eval/nim/README.md`**

```markdown
# NIM Eval Harness

Compares NVIDIA NIM models on Dishton's `structuringFromHtml` prompt.

See spec: `docs/superpowers/specs/2026-05-03-nim-eval-harness-design.md`.

## Quick start

1. Copy `urls.txt.example` to `urls.txt` and add recipe URLs.
2. Edit `models.ts` to set the candidate list.
3. Set `NVIDIA_API_KEY` in `.env` at the repo root.
4. Run: `pnpm eval:nim`
5. Open the latest file under `eval/nim/runs/` and ask Claude Code:
   *"judge the latest run"*. The session reads the report, fills in
   the `TBD` rubric placeholders, and writes a leaderboard at the top.

## CLI flags

- `--repeat N` — repeat each (URL, model) call N times; latency is the median
- `--concurrency N` — bounded URL fan-out per model (default 2)
- `--out <path>` — override report output path
- `--dry-run` — validate config + URL list + env, do not call NIM
```

- [ ] **Step 5: Append to `.gitignore`**

Append these lines (preserve the trailing blank line at the end of the file):

```
# Eval harness (developer tool)
eval/nim/urls.txt
eval/nim/runs/
```

- [ ] **Step 6: Modify `package.json` scripts**

Add these two entries to the `"scripts"` object (after `"test:e2e"`):

```json
    "eval:nim": "deno run --env-file=.env --config eval/nim/deno.json --allow-net --allow-read --allow-env --allow-write eval/nim/run.ts eval/nim/urls.txt",
    "test:eval": "deno test --config eval/nim/deno.json -A eval/nim"
```

- [ ] **Step 7: Verify scaffolding**

```bash
test -d eval/nim/runs
test -f eval/nim/deno.json
test -f eval/nim/urls.txt.example
test -f eval/nim/README.md
grep -q "eval/nim/urls.txt" .gitignore
grep -q "eval:nim" package.json
```

All seven checks should print nothing (success) and exit 0.

- [ ] **Step 8: Commit**

```bash
git add eval/nim/deno.json eval/nim/urls.txt.example eval/nim/README.md .gitignore package.json
git commit -m "chore(eval): scaffold NIM eval harness directory"
```

---

## Task 2: `models.ts` — config types and candidate list

**Files:**
- Create: `eval/nim/models.ts`
- Test: `eval/nim/_test.ts` (added in this task; expanded in later tasks)

`models.ts` is hand-edited by the user to choose which models compete. It Zod-validates itself on load so a typo surfaces immediately.

- [ ] **Step 1: Write the failing test**

Create `eval/nim/_test.ts` with this content:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test:eval
```

Expected: failure with `Module not found "./models.ts"`.

- [ ] **Step 3: Create `eval/nim/models.ts`**

```ts
// Hand-edited config for the NIM eval harness. Change `candidates` to choose
// which models compete on the next run.

import { z } from 'zod';

export const CandidateSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
});

export const EvalConfigSchema = z.object({
  candidates: z.array(CandidateSchema).min(1),
  concurrency: z.number().int().positive(),
  repeat: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
});

export type Candidate = z.infer<typeof CandidateSchema>;
export type EvalConfig = z.infer<typeof EvalConfigSchema>;

export const config: EvalConfig = EvalConfigSchema.parse({
  candidates: [
    { id: 'nvidia/llama-3.1-nemotron-70b-instruct', label: 'nemotron-70b' },
    { id: 'meta/llama-3.3-70b-instruct', label: 'llama-3.3-70b' },
  ],
  concurrency: 2,
  repeat: 1,
  timeoutMs: 90_000,
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test:eval
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add eval/nim/models.ts eval/nim/_test.ts
git commit -m "feat(eval): models.ts config with Zod validation"
```

---

## Task 3: `fetch.ts` — URL fetch + Readability extract

**Files:**
- Create: `eval/nim/fetch.ts`
- Modify: `eval/nim/_test.ts`

We split the module into a pure `extractFromHtml(html)` (testable without network) and a `fetchAndExtract(url)` that does the network call. Tests target the pure function. Mirrors `import-url/index.ts` for byte cap, timeout, UA, and Readability fallback.

- [ ] **Step 1: Append failing tests to `eval/nim/_test.ts`**

Append these tests at the bottom of the file:

```ts
import { extractFromHtml } from './fetch.ts';

const SAMPLE_ARTICLE_HTML = `
<!DOCTYPE html>
<html><head><title>Test Recipe</title></head>
<body>
  <article>
    <h1>Chocolate Cake</h1>
    <p>This is the most important paragraph of the article. It contains
    enough text for Readability to consider it the main content of the page,
    not navigation chrome. We need at least a few hundred characters here so
    Readability does not bail out on a sparse page. The cake is delicious.
    Mix flour, sugar, cocoa, eggs, and milk. Bake for 30 minutes at 180C.
    Serves 8 people.</p>
    <p>Cool before serving. The cake stores well in an airtight container
    for up to three days at room temperature.</p>
  </article>
</body></html>
`;

const EMPTY_HTML = `<!DOCTYPE html><html><body></body></html>`;

Deno.test('fetch: extractFromHtml returns Readability text on a normal page', () => {
  const r = extractFromHtml(SAMPLE_ARTICLE_HTML, SAMPLE_ARTICLE_HTML.length);
  assertEquals(r.readabilityUsed, true);
  assertEquals(r.text.includes('Chocolate Cake'), true);
  assertEquals(r.text.includes('Bake for 30 minutes'), true);
  assertEquals(r.bytes, SAMPLE_ARTICLE_HTML.length);
});

Deno.test('fetch: extractFromHtml falls back to raw HTML when Readability is empty', () => {
  const r = extractFromHtml(EMPTY_HTML, EMPTY_HTML.length);
  assertEquals(r.readabilityUsed, false);
  assertEquals(r.text, EMPTY_HTML);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test:eval
```

Expected: failure with `Module not found "./fetch.ts"`.

- [ ] **Step 3: Create `eval/nim/fetch.ts`**

```ts
// URL fetch + Readability extract. Mirrors the byte cap, timeout, UA, and
// fallback behavior of supabase/functions/import-url/index.ts so the eval
// feeds models the same input production does.

import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

const MAX_BYTES = 5_000_000;
const FETCH_TIMEOUT_MS = 15_000;
const USER_AGENT = 'DishtonBot/0.1 (+https://dishton.app)';

export type ExtractResult = {
  text: string;
  bytes: number;
  readabilityUsed: boolean;
};

export class FetchError extends Error {
  constructor(
    public reason:
      | 'fetch_failed'
      | 'not_html'
      | 'empty_body'
      | 'too_large'
      | 'timeout'
      | 'network',
    public detail?: unknown,
  ) {
    super(`fetch ${reason}`);
  }
}

export async function fetchAndExtract(
  url: string,
  signal?: AbortSignal,
): Promise<ExtractResult> {
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'user-agent': USER_AGENT },
      signal: ac.signal,
    }).catch((err) => {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new FetchError('timeout');
      }
      throw new FetchError('network', String((err as Error).message ?? err));
    });
    if (!res.ok) throw new FetchError('fetch_failed', { status: res.status });
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('text/html')) throw new FetchError('not_html');
    const reader = res.body?.getReader();
    if (!reader) throw new FetchError('empty_body');
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        total += value.length;
        if (total > MAX_BYTES) throw new FetchError('too_large');
        chunks.push(value);
      }
    }
    const html = new TextDecoder('utf-8').decode(concat(chunks));
    return extractFromHtml(html, total);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export function extractFromHtml(html: string, bytes: number): ExtractResult {
  const dom = parseHTML(html);
  const reader = new Readability(dom.document);
  const article = reader.parse();
  const text = article?.textContent?.trim() ?? '';
  if (text.length > 0) {
    return { text, bytes, readabilityUsed: true };
  }
  return { text: html, bytes, readabilityUsed: false };
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const len = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(len);
  let i = 0;
  for (const c of chunks) {
    out.set(c, i);
    i += c.length;
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test:eval
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add eval/nim/fetch.ts eval/nim/_test.ts
git commit -m "feat(eval): fetch.ts URL + Readability extract"
```

---

## Task 4: `client.ts` — minimal NIM caller (no retry)

**Files:**
- Create: `eval/nim/client.ts`
- Modify: `eval/nim/_test.ts`

Direct POST to `/v1/chat/completions`. No retries. Records latency. Accepts a `fetchImpl` injection so tests run without network.

- [ ] **Step 1: Append failing tests to `eval/nim/_test.ts`**

Append at the bottom:

```ts
import { callNim, NimError } from './client.ts';

function mockFetch(impl: (req: Request) => Response | Promise<Response>): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' || input instanceof URL ? input.toString() : input.url;
    const req = new Request(url, init);
    return impl(req);
  };
}

Deno.test('client: callNim returns content + usage + latency on 200', async () => {
  const fetchImpl = mockFetch(() =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"hello":"world"}' } }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  );
  const r = await callNim({
    apiKey: 'test-key',
    model: 'm',
    messages: [{ role: 'user', content: 'hi' }],
    timeoutMs: 5_000,
    fetchImpl,
  });
  assertEquals(r.raw, '{"hello":"world"}');
  assertEquals(r.usage.input, 100);
  assertEquals(r.usage.output, 20);
  assertEquals(typeof r.latencyMs, 'number');
  assertEquals(r.latencyMs >= 0, true);
});

Deno.test('client: callNim throws NimError(http) on non-2xx', async () => {
  const fetchImpl = mockFetch(() =>
    new Response('upstream broke', { status: 500 })
  );
  let caught: unknown;
  try {
    await callNim({
      apiKey: 'test-key',
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      timeoutMs: 5_000,
      fetchImpl,
    });
  } catch (e) {
    caught = e;
  }
  assertEquals(caught instanceof NimError, true);
  assertEquals((caught as NimError).kind, 'http');
  assertEquals((caught as NimError).status, 500);
});

Deno.test('client: callNim throws NimError(timeout) when timeoutMs elapses', async () => {
  const fetchImpl = mockFetch(
    (req) =>
      new Promise<Response>((resolve, reject) => {
        req.signal.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
        // never resolve
      }),
  );
  let caught: unknown;
  try {
    await callNim({
      apiKey: 'test-key',
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      timeoutMs: 50,
      fetchImpl,
    });
  } catch (e) {
    caught = e;
  }
  assertEquals(caught instanceof NimError, true);
  assertEquals((caught as NimError).kind, 'timeout');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test:eval
```

Expected: failure with `Module not found "./client.ts"`.

- [ ] **Step 3: Create `eval/nim/client.ts`**

```ts
// Minimal NIM client for the eval harness. No retries (production retries
// hide reliability differences between models, which we want to surface).
// Accepts fetchImpl injection for testing.

import type { NimMessage } from '../../supabase/functions/_shared/ai/client.ts';

const BASE_URL = 'https://integrate.api.nvidia.com/v1';

export class NimError extends Error {
  constructor(
    public kind: 'http' | 'timeout' | 'network',
    public status?: number,
    public body?: string,
  ) {
    super(`nim ${kind}${status !== undefined ? ` ${status}` : ''}`);
  }
}

export type CallResult = {
  raw: string;
  usage: { input: number; output: number };
  latencyMs: number;
};

type ChatCompletionResponse = {
  choices: Array<{ message: { content: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export async function callNim(opts: {
  apiKey: string;
  model: string;
  messages: NimMessage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<CallResult> {
  const fetchFn = opts.fetchImpl ?? fetch;
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  opts.signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs);
  const start = performance.now();
  try {
    const res = await fetchFn(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'authorization': `Bearer ${opts.apiKey}`,
        'content-type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        temperature: opts.temperature ?? 0.1,
        response_format: { type: 'json_object' },
        max_tokens: opts.maxTokens ?? 4096,
        stream: false,
      }),
    });
    const latencyMs = Math.round(performance.now() - start);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new NimError('http', res.status, body.slice(0, 500));
    }
    const data = (await res.json()) as ChatCompletionResponse;
    return {
      raw: data.choices[0]?.message?.content ?? '',
      usage: {
        input: data.usage?.prompt_tokens ?? 0,
        output: data.usage?.completion_tokens ?? 0,
      },
      latencyMs,
    };
  } catch (err) {
    if (err instanceof NimError) throw err;
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new NimError('timeout');
    }
    throw new NimError('network', undefined, String((err as Error).message ?? err));
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test:eval
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add eval/nim/client.ts eval/nim/_test.ts
git commit -m "feat(eval): client.ts NIM caller without retry"
```

---

## Task 5: `report.ts` — aggregations, console table, Markdown writer

**Files:**
- Create: `eval/nim/report.ts`
- Modify: `eval/nim/_test.ts`

Two outputs: a console table and a Markdown file with `TBD` placeholders for the judge. Aggregates metrics per model: schema-pass rate, latency p50/p95, average tokens, error counts.

- [ ] **Step 1: Append failing tests to `eval/nim/_test.ts`**

Append at the bottom:

```ts
import { writeMarkdown, percentile, aggregate, type RunResults } from './report.ts';

Deno.test('report: percentile p50 of [1,2,3] is 2', () => {
  assertEquals(percentile([1, 2, 3], 50), 2);
});

Deno.test('report: percentile p95 of [10,20,30,40,50,60,70,80,90,100] is 100', () => {
  assertEquals(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 95), 100);
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test:eval
```

Expected: failure with `Module not found "./report.ts"`.

- [ ] **Step 3: Create `eval/nim/report.ts`**

```ts
// Console table + Markdown writer. The Markdown report contains TBD
// placeholders that the active Claude Code session fills in interactively.

export type ModelOutcome = {
  url: string;
  model: string;
  modelLabel?: string;
  schemaOk: boolean;
  latencyMs: number | null;
  tokensIn: number;
  tokensOut: number;
  raw: string;
  error?: string;
  repeatLatenciesMs?: number[];
};

export type UrlBundle = {
  url: string;
  sourceExcerpt: string;
  readabilityUsed: boolean;
  outcomes: ModelOutcome[];
};

export type RunResults = {
  startedAt: string;
  finishedAt: string;
  config: {
    models: { id: string; label?: string }[];
    concurrency: number;
    repeat: number;
    timeoutMs: number;
  };
  urls: UrlBundle[];
  skippedUrls: { url: string; reason: string }[];
};

export type ModelAggregate = {
  model: string;
  modelLabel?: string;
  schemaOk: string;       // e.g. "8/10"
  schemaOkPct: number;    // 0..1
  p50Ms: number | null;
  p95Ms: number | null;
  avgTokensIn: number;
  avgTokensOut: number;
  errors: string[];
};

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo]!;
  const frac = rank - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

export function aggregate(results: RunResults): ModelAggregate[] {
  const byModel = new Map<string, ModelOutcome[]>();
  for (const u of results.urls) {
    for (const o of u.outcomes) {
      const arr = byModel.get(o.model) ?? [];
      arr.push(o);
      byModel.set(o.model, arr);
    }
  }
  const out: ModelAggregate[] = [];
  for (const m of results.config.models) {
    const outcomes = byModel.get(m.id) ?? [];
    const okCount = outcomes.filter((o) => o.schemaOk).length;
    const latencies = outcomes
      .map((o) => o.latencyMs)
      .filter((v): v is number => typeof v === 'number');
    const errors = outcomes.filter((o) => !o.schemaOk).map((o) => o.error ?? 'unknown');
    const tokensIn = outcomes.length > 0
      ? Math.round(outcomes.reduce((n, o) => n + o.tokensIn, 0) / outcomes.length)
      : 0;
    const tokensOut = outcomes.length > 0
      ? Math.round(outcomes.reduce((n, o) => n + o.tokensOut, 0) / outcomes.length)
      : 0;
    out.push({
      model: m.id,
      modelLabel: m.label,
      schemaOk: `${okCount}/${outcomes.length}`,
      schemaOkPct: outcomes.length > 0 ? okCount / outcomes.length : 0,
      p50Ms: percentile(latencies, 50),
      p95Ms: percentile(latencies, 95),
      avgTokensIn: tokensIn,
      avgTokensOut: tokensOut,
      errors,
    });
  }
  // sort by schema_ok desc then p50 asc
  out.sort((a, b) => {
    if (a.schemaOkPct !== b.schemaOkPct) return b.schemaOkPct - a.schemaOkPct;
    const ap = a.p50Ms ?? Number.POSITIVE_INFINITY;
    const bp = b.p50Ms ?? Number.POSITIVE_INFINITY;
    return ap - bp;
  });
  return out;
}

export function renderConsole(results: RunResults): void {
  const agg = aggregate(results);
  const lines: string[] = [];
  lines.push(`=== NIM Eval — ${results.startedAt} ===`);
  lines.push(`Models: ${results.config.models.map((m) => m.label ?? m.id).join(', ')}`);
  lines.push(`URLs:   ${results.urls.length}`);
  lines.push('');
  const headers = ['Model', 'schema_ok', 'p50_ms', 'p95_ms', 'tokens_in', 'tokens_out', 'errors'];
  const rows = agg.map((r) => [
    r.modelLabel ?? r.model,
    r.schemaOk,
    r.p50Ms === null ? '-' : Math.round(r.p50Ms).toString(),
    r.p95Ms === null ? '-' : Math.round(r.p95Ms).toString(),
    r.avgTokensIn.toString(),
    r.avgTokensOut.toString(),
    r.errors.length === 0 ? '0' : `${r.errors.length} (${dedupe(r.errors).join(', ')})`,
  ]);
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => row[i]!.length))
  );
  const fmt = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i]!)).join('  ');
  lines.push(fmt(headers));
  lines.push(fmt(widths.map((w) => '-'.repeat(w))));
  for (const row of rows) lines.push(fmt(row));
  console.log(lines.join('\n'));
}

function dedupe<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

export async function writeMarkdown(
  results: RunResults,
  outPath: string,
): Promise<void> {
  const agg = aggregate(results);
  const md: string[] = [];
  md.push(`# NIM Eval Run — ${results.startedAt}`);
  md.push('');
  md.push('## Leaderboard');
  md.push('');
  md.push(
    '| Model | schema_ok | latency p50 | overall | completeness | fidelity | format |',
  );
  md.push('|-------|-----------|-------------|---------|--------------|----------|--------|');
  for (const r of agg) {
    const p50 = r.p50Ms === null ? '-' : `${Math.round(r.p50Ms)} ms`;
    md.push(
      `| ${r.modelLabel ?? r.model} | ${r.schemaOk} | ${p50} | TBD | TBD | TBD | TBD |`,
    );
  }
  md.push('');
  md.push('## Run config');
  md.push(`- Started:     ${results.startedAt}`);
  md.push(`- Finished:    ${results.finishedAt}`);
  md.push(`- Models:      ${results.config.models.map((m) => `${m.label ?? m.id}`).join(', ')}`);
  md.push(`- URLs:        ${results.urls.length}`);
  md.push(`- Concurrency: ${results.config.concurrency}`);
  md.push(`- Repeat:      ${results.config.repeat}`);
  md.push(`- Timeout:     ${results.config.timeoutMs} ms`);
  md.push('');
  md.push('## Per-URL results');
  md.push('');
  for (let i = 0; i < results.urls.length; i++) {
    const u = results.urls[i]!;
    md.push(`### URL ${i + 1} — ${u.url}`);
    md.push('');
    md.push(
      `**Source excerpt** (first 2000 chars of cleaned text${u.readabilityUsed ? '' : ', Readability fell back to raw HTML'}):`,
    );
    md.push('');
    md.push('```');
    md.push(u.sourceExcerpt);
    md.push('```');
    md.push('');
    for (const o of u.outcomes) {
      md.push(`#### Model: ${o.modelLabel ?? o.model}`);
      md.push(`- schema_ok: ${o.schemaOk}`);
      md.push(`- latency_ms: ${o.latencyMs ?? '-'}`);
      md.push(`- tokens_in: ${o.tokensIn}, tokens_out: ${o.tokensOut}`);
      md.push(`- error: ${o.error ?? '—'}`);
      if (o.repeatLatenciesMs && o.repeatLatenciesMs.length > 1) {
        md.push(`- repeat latencies: ${o.repeatLatenciesMs.join(', ')}`);
      }
      md.push('');
      md.push('**Raw output:**');
      md.push('');
      md.push('```json');
      md.push(o.raw);
      md.push('```');
      md.push('');
      md.push('**Judge:**');
      md.push('- Completeness: TBD');
      md.push('- Fidelity: TBD');
      md.push('- Format hygiene: TBD');
      md.push('- Overall: TBD');
      md.push('- Notes: TBD');
      md.push('');
    }
  }
  if (results.skippedUrls.length > 0) {
    md.push('## Skipped URLs');
    md.push('');
    for (const s of results.skippedUrls) {
      md.push(`- ${s.url} — ${s.reason}`);
    }
    md.push('');
  } else {
    md.push('## Skipped URLs');
    md.push('');
    md.push('_None._');
    md.push('');
  }
  await Deno.writeTextFile(outPath, md.join('\n'));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test:eval
```

Expected: 13 tests pass.

- [ ] **Step 5: Commit**

```bash
git add eval/nim/report.ts eval/nim/_test.ts
git commit -m "feat(eval): report.ts console table + Markdown writer"
```

---

## Task 6: `run.ts` — orchestrator and CLI entry point

**Files:**
- Create: `eval/nim/run.ts`

`run.ts` is the orchestrator. It is not unit-tested (it is an interactive tool; we verify it by running it in Task 7). It does:

1. Parse CLI args.
2. Load config + env.
3. Read URL list (skip blanks and `#` comments).
4. Phase 1: fetch each URL once.
5. Phase 2: for each candidate model (sequential), fan out URLs (bounded concurrency), call NIM, parse + Zod-validate, record outcome. Each (URL, model) is repeated `repeat` times; latency is the median, `schemaOk` is true only if all repeats pass.
6. Write report.
7. Print console summary.

- [ ] **Step 1: Create `eval/nim/run.ts`**

```ts
// Orchestrator. Loads config + URLs, fetches each URL once, fans out to every
// candidate model with bounded concurrency, writes Markdown report.

import { config as defaultConfig, type EvalConfig } from './models.ts';
import { fetchAndExtract, FetchError } from './fetch.ts';
import { callNim, NimError } from './client.ts';
import {
  renderConsole,
  writeMarkdown,
  type ModelOutcome,
  type RunResults,
  type UrlBundle,
} from './report.ts';
import { structuringFromHtml } from '../../supabase/functions/_shared/ai/prompts.ts';
import { Recipe } from '../../src/domain/recipe.ts';

type CliArgs = {
  urlsFile: string;
  repeat: number;
  concurrency: number;
  out: string | null;
  dryRun: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  let urlsFile: string | null = null;
  let repeat: number | null = null;
  let concurrency: number | null = null;
  let out: string | null = null;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--repeat') {
      repeat = parseInt(argv[++i] ?? '', 10);
    } else if (a === '--concurrency') {
      concurrency = parseInt(argv[++i] ?? '', 10);
    } else if (a === '--out') {
      out = argv[++i] ?? null;
    } else if (a === '--dry-run') {
      dryRun = true;
    } else if (a.startsWith('--')) {
      throw new Error(`unknown flag: ${a}`);
    } else {
      if (urlsFile === null) urlsFile = a;
      else throw new Error(`unexpected positional arg: ${a}`);
    }
  }
  if (urlsFile === null) {
    throw new Error('usage: run.ts <urls-file> [--repeat N] [--concurrency N] [--out PATH] [--dry-run]');
  }
  return {
    urlsFile,
    repeat: repeat ?? 0,        // 0 means "use config default"
    concurrency: concurrency ?? 0,
    out,
    dryRun,
  };
}

function applyOverrides(base: EvalConfig, args: CliArgs): EvalConfig {
  return {
    ...base,
    repeat: args.repeat > 0 ? args.repeat : base.repeat,
    concurrency: args.concurrency > 0 ? args.concurrency : base.concurrency,
  };
}

async function readUrlList(path: string): Promise<string[]> {
  const text = await Deno.readTextFile(path);
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    out.push(line);
  }
  return out;
}

function defaultOutPath(now: Date): string {
  const iso = now.toISOString().replace(/[:.]/g, '_');
  return `eval/nim/runs/${iso}.md`;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 === 0 ? (s[n / 2 - 1]! + s[n / 2]!) / 2 : s[(n - 1) / 2]!;
}

function classifyValidationError(raw: string): { schemaOk: false; error: string } {
  // Try parse first
  let parsed: unknown;
  try {
    const cleaned = raw.trim().replace(/^```json\s*/, '').replace(/\s*```$/, '');
    parsed = JSON.parse(cleaned);
  } catch (e) {
    return { schemaOk: false, error: `parse: ${(e as Error).message.slice(0, 80)}` };
  }
  const safe = Recipe.safeParse(parsed);
  if (!safe.success) {
    const issue = safe.error.issues[0];
    const path = issue?.path.join('.') ?? '';
    return { schemaOk: false, error: `schema: ${path}` };
  }
  // Should not reach here
  return { schemaOk: false, error: 'unknown' };
}

function validateRaw(raw: string): { schemaOk: true } | { schemaOk: false; error: string } {
  let parsed: unknown;
  try {
    const cleaned = raw.trim().replace(/^```json\s*/, '').replace(/\s*```$/, '');
    parsed = JSON.parse(cleaned);
  } catch (e) {
    return { schemaOk: false, error: `parse: ${(e as Error).message.slice(0, 80)}` };
  }
  const safe = Recipe.safeParse(parsed);
  if (!safe.success) {
    const issue = safe.error.issues[0];
    const path = issue?.path.join('.') ?? '';
    return { schemaOk: false, error: `schema: ${path}` };
  }
  return { schemaOk: true };
}

async function callOnce(args: {
  apiKey: string;
  model: { id: string; label?: string; temperature?: number; maxTokens?: number };
  url: string;
  cleanedText: string;
  timeoutMs: number;
}): Promise<{
  raw: string;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  schemaOk: boolean;
  error?: string;
}> {
  try {
    const r = await callNim({
      apiKey: args.apiKey,
      model: args.model.id,
      messages: structuringFromHtml({ html: args.cleanedText, sourceUrl: args.url }),
      temperature: args.model.temperature,
      maxTokens: args.model.maxTokens,
      timeoutMs: args.timeoutMs,
    });
    const v = validateRaw(r.raw);
    if (v.schemaOk) {
      return {
        raw: r.raw,
        latencyMs: r.latencyMs,
        tokensIn: r.usage.input,
        tokensOut: r.usage.output,
        schemaOk: true,
      };
    }
    return {
      raw: r.raw,
      latencyMs: r.latencyMs,
      tokensIn: r.usage.input,
      tokensOut: r.usage.output,
      schemaOk: false,
      error: v.error,
    };
  } catch (err) {
    if (err instanceof NimError) {
      const errLabel = err.kind === 'http'
        ? `http_${err.status ?? 'unknown'}`
        : err.kind;
      return {
        raw: err.body ?? '',
        latencyMs: 0,
        tokensIn: 0,
        tokensOut: 0,
        schemaOk: false,
        error: errLabel,
      };
    }
    throw err;
  }
}

async function evaluateUrl(args: {
  apiKey: string;
  model: { id: string; label?: string; temperature?: number; maxTokens?: number };
  url: string;
  cleanedText: string;
  timeoutMs: number;
  repeat: number;
}): Promise<ModelOutcome> {
  const calls: {
    raw: string;
    latencyMs: number;
    tokensIn: number;
    tokensOut: number;
    schemaOk: boolean;
    error?: string;
  }[] = [];
  for (let i = 0; i < args.repeat; i++) {
    calls.push(await callOnce({
      apiKey: args.apiKey,
      model: args.model,
      url: args.url,
      cleanedText: args.cleanedText,
      timeoutMs: args.timeoutMs,
    }));
  }
  const allOk = calls.every((c) => c.schemaOk);
  const latencies = calls.map((c) => c.latencyMs);
  const last = calls[calls.length - 1]!;
  return {
    url: args.url,
    model: args.model.id,
    modelLabel: args.model.label,
    schemaOk: allOk,
    latencyMs: median(latencies),
    tokensIn: Math.round(calls.reduce((n, c) => n + c.tokensIn, 0) / calls.length),
    tokensOut: Math.round(calls.reduce((n, c) => n + c.tokensOut, 0) / calls.length),
    raw: last.raw,
    error: allOk ? undefined : (calls.find((c) => !c.schemaOk)?.error ?? 'unknown'),
    repeatLatenciesMs: args.repeat > 1 ? latencies : undefined,
  };
}

async function withConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.max(1, Math.min(limit, items.length)); i++) {
    workers.push((async () => {
      while (true) {
        const idx = next++;
        if (idx >= items.length) return;
        results[idx] = await fn(items[idx]!);
      }
    })());
  }
  await Promise.all(workers);
  return results;
}

async function main(): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(Deno.args);
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    return 2;
  }

  const apiKey = Deno.env.get('NVIDIA_API_KEY');
  if (!apiKey) {
    console.error('error: NVIDIA_API_KEY is not set');
    return 2;
  }

  let urls: string[];
  try {
    urls = await readUrlList(args.urlsFile);
  } catch (e) {
    console.error(`error: cannot read urls file ${args.urlsFile}: ${(e as Error).message}`);
    return 2;
  }
  if (urls.length === 0) {
    console.error(`error: no URLs in ${args.urlsFile}`);
    return 2;
  }

  const cfg = applyOverrides(defaultConfig, args);

  if (args.dryRun) {
    console.log('dry-run OK');
    console.log(`models:      ${cfg.candidates.map((c) => c.label ?? c.id).join(', ')}`);
    console.log(`urls:        ${urls.length}`);
    console.log(`concurrency: ${cfg.concurrency}`);
    console.log(`repeat:      ${cfg.repeat}`);
    return 0;
  }

  const startedAt = new Date();

  // Phase 1: fetch all URLs once
  const fetched: { url: string; text: string; readabilityUsed: boolean }[] = [];
  const skipped: { url: string; reason: string }[] = [];
  for (const url of urls) {
    try {
      const r = await fetchAndExtract(url);
      fetched.push({ url, text: r.text, readabilityUsed: r.readabilityUsed });
      console.error(`fetched: ${url} (${r.bytes} bytes, readability=${r.readabilityUsed})`);
    } catch (e) {
      const reason = e instanceof FetchError ? e.reason : 'network';
      skipped.push({ url, reason });
      console.error(`skipped: ${url} — ${reason}`);
    }
  }

  // Phase 2: per model (sequential), per URL (concurrent within model)
  const bundles: UrlBundle[] = fetched.map((f) => ({
    url: f.url,
    sourceExcerpt: f.text.slice(0, 2000),
    readabilityUsed: f.readabilityUsed,
    outcomes: [],
  }));
  const indexByUrl = new Map(bundles.map((b, i) => [b.url, i]));

  for (const cand of cfg.candidates) {
    console.error(`evaluating model: ${cand.label ?? cand.id}`);
    const outcomes = await withConcurrency(fetched, cfg.concurrency, async (f) => {
      const o = await evaluateUrl({
        apiKey,
        model: cand,
        url: f.url,
        cleanedText: f.text,
        timeoutMs: cfg.timeoutMs,
        repeat: cfg.repeat,
      });
      console.error(
        `  ${f.url} → schema_ok=${o.schemaOk} latency=${o.latencyMs}ms${o.error ? ` error=${o.error}` : ''}`,
      );
      return o;
    });
    for (const o of outcomes) {
      const idx = indexByUrl.get(o.url)!;
      bundles[idx]!.outcomes.push(o);
    }
  }

  const finishedAt = new Date();
  const results: RunResults = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    config: {
      models: cfg.candidates.map((c) => ({ id: c.id, label: c.label })),
      concurrency: cfg.concurrency,
      repeat: cfg.repeat,
      timeoutMs: cfg.timeoutMs,
    },
    urls: bundles,
    skippedUrls: skipped,
  };

  const outPath = args.out ?? defaultOutPath(startedAt);
  try {
    await writeMarkdown(results, outPath);
  } catch (e) {
    console.error(`error: cannot write report to ${outPath}: ${(e as Error).message}`);
    return 2;
  }

  renderConsole(results);
  console.log('');
  console.log(`Wrote: ${outPath}`);
  console.log(`Next:  in Claude Code, ask "judge the latest run" to fill the placeholders.`);
  return 0;
}

if (import.meta.main) {
  Deno.exit(await main());
}
```

Note: `classifyValidationError` is unused (`validateRaw` does the work directly). Remove it before committing.

- [ ] **Step 2: Remove the unused `classifyValidationError` function**

Open `eval/nim/run.ts` and delete the `classifyValidationError` function (it was a leftover from refactoring; `validateRaw` does the same job).

- [ ] **Step 3: Type-check**

```bash
deno check --config eval/nim/deno.json eval/nim/run.ts
```

Expected: no errors.

- [ ] **Step 4: Re-run all tests**

```bash
pnpm test:eval
```

Expected: 13 tests still pass.

- [ ] **Step 5: Commit**

```bash
git add eval/nim/run.ts
git commit -m "feat(eval): run.ts orchestrator + CLI entry point"
```

---

## Task 7: Smoke test the harness end-to-end

**Files:**
- None modified.

This task does no commits — it verifies the whole thing actually works against the real NIM API on one small URL with one cheap model. If anything breaks, fix it via additional commits within this task.

- [ ] **Step 1: Verify env**

```bash
deno run --env-file=.env --allow-env -e "console.log(Deno.env.get('NVIDIA_API_KEY') ? 'ok' : 'missing')"
```

Expected: `ok`. If `missing`, add `NVIDIA_API_KEY=...` to `.env` at the repo root and re-run.

- [ ] **Step 2: Create a one-URL `urls.txt`**

Create the file with a known-good recipe URL (the user can choose; `https://www.bbcgoodfood.com/recipes/easy-chocolate-cake` is a reliable example):

```
# smoke test
https://www.bbcgoodfood.com/recipes/easy-chocolate-cake
```

Save as `eval/nim/urls.txt` (this file is gitignored).

- [ ] **Step 3: Run dry-run**

```bash
pnpm eval:nim -- --dry-run
```

Expected:
```
dry-run OK
models:      nemotron-70b, llama-3.3-70b
urls:        1
concurrency: 2
repeat:      1
```

- [ ] **Step 4: Edit `models.ts` to use one cheap model for the smoke**

Temporarily reduce `candidates` in `eval/nim/models.ts` to a single entry to keep the smoke run cheap. Example (revert before final commit if you change it):

```ts
candidates: [
  { id: 'meta/llama-3.3-70b-instruct', label: 'llama-3.3-70b' },
],
```

- [ ] **Step 5: Run the harness**

```bash
pnpm eval:nim
```

Expected:
- A `fetched: ...` line.
- An `evaluating model: llama-3.3-70b` line.
- A per-URL result line.
- A console table.
- `Wrote: eval/nim/runs/<timestamp>.md`

- [ ] **Step 6: Inspect the report**

```bash
ls eval/nim/runs/
```

Open the generated `.md` file and verify it contains:
- `## Leaderboard` table
- `## Run config`
- `## Per-URL results` with one URL block
- One `**Judge:**` block with five `TBD` lines
- `## Skipped URLs` section

- [ ] **Step 7: Restore the candidate list (if you reduced it)**

Revert `eval/nim/models.ts` to the multi-model list from Task 2.

- [ ] **Step 8: Final verification**

```bash
pnpm test:eval && deno check --config eval/nim/deno.json eval/nim/run.ts eval/nim/_test.ts
```

Expected: tests pass, no type errors.

---

## Self-review (executed inline before handing off)

**Spec coverage:**
- [x] `structuringFromHtml` reused (Task 6, run.ts imports from `prompts.ts`)
- [x] `Recipe` Zod validation (Task 6, `validateRaw`)
- [x] Phase 1 fetch once, identical input across models (Task 6 main loop)
- [x] Sequential by model, concurrent by URL (Task 6 main loop)
- [x] No retries (Task 4 client.ts)
- [x] No `_shared/env.ts` import (Task 6 reads `Deno.env.get('NVIDIA_API_KEY')` directly)
- [x] Markdown report with `## Leaderboard`, `## Run config`, `## Per-URL results`, `## Skipped URLs`, and `TBD` placeholders (Task 5)
- [x] Console table with schema_ok / p50 / p95 / tokens / errors (Task 5)
- [x] CLI flags: `--repeat`, `--concurrency`, `--out`, `--dry-run` (Task 6)
- [x] Repeat: median latency, all-must-pass for `schemaOk` (Task 6 `evaluateUrl`)
- [x] Tests for `extractFromHtml`, `callNim`, `aggregate`, `writeMarkdown` (Tasks 3, 4, 5)
- [x] `urls.txt` and `runs/` gitignored (Task 1)
- [x] `pnpm eval:nim` script (Task 1)
- [x] Not wired into CI (no CI changes anywhere in the plan)

**Placeholder scan:** No "TBD" outside the report's literal output content. No "implement later" / "fill in details" / "add appropriate error handling" anywhere in step bodies.

**Type consistency:** `RunResults`, `UrlBundle`, `ModelOutcome` field names match across `report.ts`, `run.ts`, and the tests. `NimError.kind` values (`http | timeout | network`) match between client and run consumer. `EvalConfigSchema` and `EvalConfig` names are stable. `validateRaw` is the only validator (fixed by removing the dead `classifyValidationError` in Task 6 Step 2).
