# NIM Evaluation Harness — Design

**Date:** 2026-05-03
**Status:** Draft for review
**Owner:** David
**Scope (v1):** `structuringFromHtml` only (URL import path), text lane

## Purpose

Compare candidate NVIDIA NIM models against Dishton's current production
prompts on **accuracy** and **speed of response**. Run a fixed list of recipe
URLs through every candidate model with the exact same cleaned input,
auto-measure schema-pass rate, latency, and token usage, then have the active
Claude Code session judge each output on a 1–5 rubric and edit the report in
place.

The harness is a **developer tool**, not a production code path. It bypasses
Supabase, `import_jobs`, and `withRateBudget` entirely and never writes to the
database.

## Non-goals (explicitly out of scope)

- Vision lane / `structuringFromImage`.
- `structuringFromCaption` (Instagram) and `translatePrompt`.
- Curated golden recipes / field-level diff metrics.
- Automated Claude API calls — judging is interactive in the Claude Code
  session, not via API key.
- Live UI; results are Markdown only.
- Cross-run regression tracking, persistent leaderboards, CI integration.

## Inputs

- **URL list** — `eval/nim/urls.txt`, one URL per line, gitignored. The user
  curates this; the harness does not auto-discover URLs.
- **Model config** — `eval/nim/models.ts`, exports an `EvalConfig`:

  ```ts
  type Candidate = {
    id: string;            // NIM model id, e.g. "nvidia/llama-3.1-nemotron-70b-instruct"
    label?: string;        // optional display name in the report
    temperature?: number;  // overrides default 0.1
    maxTokens?: number;    // overrides default 4096
  };

  type EvalConfig = {
    candidates: Candidate[];
    concurrency: number;   // default 2; bounded URL fan-out per model
    repeat: number;        // default 1; per-(URL,model) call repetitions for latency stability
    timeoutMs: number;     // default 90_000 per call
  };
  ```

- **Env** — `NVIDIA_API_KEY` only. Read via `Deno.env.get('NVIDIA_API_KEY')`.
  The `pnpm eval:nim` script invokes `deno run` with `--env-file=.env` so a
  local `.env` is auto-loaded. The harness deliberately does **not** import
  `supabase/functions/_shared/env.ts` because that loader requires
  `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / etc., which are irrelevant to
  evaluation and would force the user to set unrelated vars.

## Architecture

```
urls.txt  ──►  fetch + Readability  ──►  cleanedText (shared across all models)
                                              │
                                              ▼
                          for each candidate model (sequential):
                              for each URL (concurrency=2):
                                  ┌─────────────────────────────┐
                                  │ structuringFromHtml(text)   │
                                  │ → POST chat/completions     │
                                  │ → measure latency_ms        │
                                  │ → JSON.parse + Recipe.safe  │
                                  └─────────────────────────────┘
                                              │
                                              ▼
                                  per-call record (raw, latency, schema_ok, error?)
                                              │
                                              ▼
                              aggregate → console table + Markdown report
                                                              │
                                                              ▼
                                              Claude Code session reads,
                                              fills judge placeholders,
                                              adds leaderboard at top
```

### Key invariants

- **Identical input across models.** Each URL is fetched and cleaned **once**
  per run; the resulting `cleanedText` is shared across all candidate models.
  This eliminates network noise from per-model latency comparisons and prevents
  site-availability flakiness from biasing results.
- **Models compete head-to-head, not one at a time.** Within a run, every
  candidate sees the same URL set. A model failing on a URL is recorded as data
  (`schema_ok=false`, `error` populated), not raised.
- **Direct prompt reuse, no copy-paste.** The harness imports
  `structuringFromHtml` (and `RECIPE_JSON_SHAPE`) from
  `supabase/functions/_shared/ai/prompts.ts` directly, and `Recipe` from
  `src/domain/recipe.ts` directly (the canonical location;
  `_shared/domain/recipe.ts` is a symlinked mirror used by edge functions). If
  production prompts change, the eval automatically tests the new version.
  Note: `prompts.ts`'s only import is a type-only `import type { NimMessage }
  from './client.ts'`, which is erased at runtime, so importing it from the
  harness does **not** pull in the production `client.ts` or its `env.ts`
  dependency at runtime.
- **No retries.** Production `nimChat` retries on 5xx/429; the harness does not.
  An HTTP failure on model X *is* a finding; masking it with retries hides
  reliability differences.
- **Sequential by model, concurrent by URL within a model.** This avoids
  cross-model rate-limit interference while still cutting wall time.

## Components

```
eval/nim/
  models.ts      — config (candidate list, defaults)
  fetch.ts       — fetch URL + Readability extract → cleaned text
  client.ts      — minimal NIM caller (model override, no retry)
  report.ts      — console table + Markdown writer (with judge placeholders)
  run.ts         — orchestrates the pipeline; CLI entry point
  _test.ts       — Deno tests for fetch, report rendering
  urls.txt       — gitignored, user-curated input list
  runs/          — gitignored, timestamped reports
```

### `models.ts`

Pure config. Exports `config: EvalConfig`. Editing this file is how you change
which models are compared. No CLI override flag for the model list — keeping
runs reproducible from a committed file is more valuable than the convenience
of an ad-hoc flag.

### `fetch.ts`

```ts
export async function fetchAndExtract(
  url: string,
  signal?: AbortSignal,
): Promise<{ text: string; bytes: number; readabilityUsed: boolean }>;
```

Mirrors `import-url/index.ts` exactly:
- 15s fetch timeout
- 5 MB byte cap
- `text/html` content-type check
- `DishtonBot/0.1 (+https://dishton.app)` user agent
- `parseHTML` + `Readability` cleanup
- Falls back to raw HTML if Readability returns no `textContent` (matches
  production behavior)

Returns `readabilityUsed: false` when it fell back, so the report can flag it.

### `client.ts`

```ts
export async function callNim(opts: {
  model: string;
  messages: NimMessage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<{
  raw: string;
  usage: { input: number; output: number };
  latencyMs: number;
}>;
```

Direct POST to `https://integrate.api.nvidia.com/v1/chat/completions`. No
retries. Wraps the fetch in `performance.now()` deltas. Throws a typed error
with `{ kind: 'http' | 'timeout' | 'network', status?, body? }` so `run.ts`
can record it as data.

### `report.ts`

Two writers:

```ts
export function renderConsole(results: RunResults): void;
export async function writeMarkdown(results: RunResults, outPath: string): Promise<void>;
```

**Console table** (run time):

```
=== NIM Eval — 2026-05-03T14:22:01Z ===
Models: nemotron-70b, llama-3.3-70b, mixtral-8x22b
URLs:   8

Model              schema_ok  p50_ms  p95_ms  tokens_in  tokens_out  errors
nemotron-70b       8/8        2_140   3_810   3_847      612         0
llama-3.3-70b      7/8        1_920   2_980   3_847      587         1 (parse)
mixtral-8x22b      6/8        4_510   8_220   3_847      701         2 (schema, http_500)

Wrote: eval/nim/runs/2026-05-03T14_22_01Z.md
Next: judge the run by reading the file and editing the placeholder rows.
```

**Markdown report layout:**

```markdown
# NIM Eval Run — 2026-05-03T14:22:01Z

## Leaderboard
<!-- TBD: filled in after judging -->
| Model | schema_ok | latency p50 | overall | completeness | fidelity | format |
|-------|-----------|-------------|---------|--------------|----------|--------|
| ...   |           |             | TBD     | TBD          | TBD      | TBD    |

## Run config
- Models: ...
- URLs: 8
- Concurrency: 2
- Repeat: 1
- Timeout: 90s

## Per-URL results

### URL 1 — https://example.com/recipe
**Source excerpt** (first 2000 chars of cleaned text):
> ...

#### Model: nvidia/llama-3.1-nemotron-70b-instruct
- schema_ok: true
- latency_ms: 2140
- tokens_in: 3847, tokens_out: 612
- error: —

**Raw output:**
```json
{ ... full JSON ... }
```

**Judge:**
- Completeness: TBD
- Fidelity: TBD
- Format hygiene: TBD
- Overall: TBD
- Notes: TBD

#### Model: meta/llama-3.3-70b-instruct
...
```

The placeholder string is literally `TBD` so a simple grep tells me what's
left. After judging, I edit the file to replace `TBD` with scores and notes,
then fill the leaderboard table from the per-URL averages.

### `run.ts`

CLI entry point. Behavior:

1. Parse args: `<urls-file>` (positional, required), `--repeat N`,
   `--concurrency N`, `--out <path>`, `--dry-run`.
2. Load `models.ts` config; merge CLI overrides.
3. Validate env: `NVIDIA_API_KEY` must be set.
4. Read URL list; warn-and-skip empty/comment lines (`#` prefix).
5. **Phase 1 — fetch all URLs once**, sequentially with the same byte cap.
   URL fetch failures are dropped from the run with a warning and listed in a
   "Skipped URLs" section of the report.
6. **Phase 2 — per candidate model**, fan out URLs with bounded concurrency,
   call `callNim`, parse + Zod-validate, record result. Each (URL, model) pair
   is repeated `repeat` times; the recorded latency is the median across
   repeats, and `schema_ok` requires *all* repeats to pass.
7. Write report; print console summary with the path.
8. Exit 0 on success. Exit non-zero only on harness-level failure (missing
   key, file not found, malformed config, write error). A model failing every
   URL exits 0 — that is data.

### `_test.ts`

Deno tests for the deterministic units:

- `fetchAndExtract` — Readability happy path against an embedded HTML fixture;
  Readability empty-article fallback returns raw HTML.
- `report.renderConsole` — snapshot a synthetic `RunResults` and assert the
  table format (column widths, ordering by `schema_ok` desc then `p50` asc).
- `report.writeMarkdown` — write to a temp dir, assert the file contains the
  required sections (`## Leaderboard`, `## Run config`, `## Per-URL results`,
  `**Judge:**`) and that every model output has a corresponding `TBD` block.

`run.ts` end-to-end is **not** tested. It is an interactive tool; broken
behavior surfaces immediately on first use.

## Error handling

Per-call (recorded as data, never thrown):

| Failure                      | Recorded                                                |
|------------------------------|---------------------------------------------------------|
| HTTP 4xx/5xx                 | `schema_ok=false`, `error="http_<status>"`, latency = time to error |
| Timeout (default 90s)        | `error="timeout"`, latency = `timeoutMs`                |
| Network error                | `error="network"`                                       |
| `JSON.parse` failure         | `schema_ok=false`, `error="parse"`, raw saved verbatim  |
| `Recipe.safeParse` failure   | `schema_ok=false`, `error="schema:<path>"`, raw saved   |

Harness-level (exit non-zero):

- Missing `NVIDIA_API_KEY`
- URLs file missing or empty
- `models.ts` malformed (Zod-validated on load)
- Cannot write to `eval/nim/runs/`

URL-fetch failures during Phase 1 do not exit non-zero; the URL is dropped
from the run and listed in the report's "Skipped URLs" section.

## Judging workflow

After a run completes:

1. User asks the active Claude Code session: *"judge the latest run"* or
   passes the report path explicitly.
2. The session reads the Markdown file. For each `**Judge:**` block, it
   evaluates the raw model output against the source excerpt on the rubric:
   - **Completeness** (1–5) — did it capture all ingredients and steps from
     the source?
   - **Fidelity** (1–5) — are quantities/units accurate vs. the source text?
     Penalize invented or hallucinated content.
   - **Format hygiene** (1–5) — units in the canonical key set
     (`g, kg, oz, lb, ml, l, tsp, tbsp, cup_us, cup_metric, fl_oz, count, C, F, min, h`),
     `source_language` preserved, `non_scalable_qty` used when appropriate.
   - **Overall** (1–5) — holistic quality, not a strict average.
   - **Notes** — short, concrete observations (max ~2 lines).
3. The session edits the file in place, replacing every `TBD` with a score
   or note, then fills the leaderboard table at the top with per-model
   averages across URLs.
4. The session reports a one-line summary back to the user.

If `schema_ok=false`, the judge still scores the output against the source —
a hallucinated-but-valid-shape recipe should still be evaluated on
completeness and fidelity, and a parse failure can still be partly correct.

## Day-to-day usage

`package.json` script:

```json
{
  "scripts": {
    "eval:nim": "deno run --env-file=.env --allow-net --allow-read --allow-env --allow-write eval/nim/run.ts eval/nim/urls.txt"
  }
}
```

`.gitignore` additions:

```
eval/nim/urls.txt
eval/nim/runs/
```

Typical session:

```
$ pnpm eval:nim
=== NIM Eval — 2026-05-03T14:22:01Z ===
...
Wrote: eval/nim/runs/2026-05-03T14_22_01Z.md

[in claude code]
> judge the latest run
[claude reads file, fills placeholders, updates leaderboard]
> Done. Top model on overall: nemotron-70b (4.6 avg). See file for per-URL notes.
```

## Acceptance criteria

- [ ] `pnpm eval:nim` with `urls.txt` of 3+ URLs and `models.ts` of 2+
      candidates produces a console table and a Markdown report under
      `eval/nim/runs/`.
- [ ] The Markdown report contains every (URL, model) pair, with raw output,
      auto-computed metrics, and a `**Judge:**` block with five `TBD`
      placeholder lines.
- [ ] An HTTP 5xx from one model on one URL does not abort the run; the row
      is recorded with `error="http_500"`.
- [ ] A model returning invalid JSON does not abort; `error="parse"` and the
      raw text is preserved verbatim in the report.
- [ ] `RECIPE_JSON_SHAPE` and `structuringFromHtml` are imported directly
      from `supabase/functions/_shared/ai/prompts.ts` (no local copy).
- [ ] `Recipe` is imported directly from `src/domain/recipe.ts`.
- [ ] The harness does **not** import `supabase/functions/_shared/env.ts`.
- [ ] No file under `eval/nim/` calls Supabase, the `import_jobs` table, or
      `withRateBudget`.
- [ ] No file under `eval/nim/` reads `ANTHROPIC_API_KEY`.
- [ ] `eval/nim/urls.txt` and `eval/nim/runs/` are in `.gitignore`.
- [ ] Deno tests for `fetchAndExtract`, `renderConsole`, `writeMarkdown` pass.
- [ ] The harness is **not** wired into CI.

## Open questions / future work

- If the eval grows to vision or multi-prompt, consider promoting the
  cleaned-text caching to disk (`fixtures/<sha>.txt`) so model-comparison
  runs become free-of-fetch after the first.
- Cost-per-call estimation table at the bottom of the report (using
  per-model price hints) is a nice-to-have but not v1.
