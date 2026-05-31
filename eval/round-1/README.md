# Round 1 — NIM vs. Claude on `structuringFromHtml`

**Date:** 2026-05-03
**Judge:** interactive Claude Code session (1-5 rubric)
**Prompt under test:** `structuringFromHtml` (URL import, text lane) from
[`supabase/functions/_shared/ai/prompts.ts`](../../supabase/functions/_shared/ai/prompts.ts)
**Harness:** Deno CLI in [`eval/nim/`](../nim/).
Design: [spec](../../docs/superpowers/specs/2026-05-03-nim-eval-harness-design.md) /
[plan](../../docs/superpowers/plans/2026-05-03-nim-eval-harness.md).

## TL;DR

- **`claude-haiku-4-5` is the best overall value** — top judged overall (4.2/5),
  best fidelity (4.5/5), and clearly the fastest of the quality tier
  (p50 7.5 s). One schema-fail, and it was honest (`servings=null` on a source
  with no ingredient list), not a hallucination.
- **`claude-sonnet-4-6` is the quality reference / safety net** — perfect 6/6
  schema and perfect format hygiene (5.0), at roughly 2x the latency
  (p50 13.7 s). Slightly lower completeness (missed yeast + salt on one bread).
- **NIM access was the real problem, not quality.** 4 of 5 NIM candidates
  produced no usable output (404 / 500 / timeout). Only `meta/llama-3.1-8b-instruct`
  ran end-to-end, at mid quality (overall 3.0).

## What was tested

Each recipe URL is fetched and Readability-cleaned **once**, then the identical
cleaned text is fed to every candidate model through the production
`structuringFromHtml` prompt. The harness auto-measures schema-pass rate
(against the canonical `Recipe` Zod schema), latency, and token usage; the
Claude Code session then judges each raw output against the source excerpt on a
1-5 rubric (completeness / fidelity / format hygiene / overall).

- **No retries** — an HTTP 4xx/5xx/timeout is recorded as data, so model
  reliability differences surface instead of being masked.
- **`repeat=1`, `concurrency=2`, `timeoutMs=90000`** for this run.
- **Source excerpt = first 2000 chars** of cleaned text (this matters — see
  finding 3).

## Candidates (7)

| Label | Provider | Model id |
|-------|----------|----------|
| nemotron-70b | nim | `nvidia/llama-3.1-nemotron-70b-instruct` |
| llama-3.3-70b | nim | `meta/llama-3.3-70b-instruct` |
| qwen2.5-72b | nim | `qwen/qwen2.5-72b-instruct` |
| mixtral-8x22b | nim | `mistralai/mixtral-8x22b-instruct-v0.1` |
| llama-3.1-8b | nim | `meta/llama-3.1-8b-instruct` |
| haiku-4.5 | anthropic | `claude-haiku-4-5-20251001` |
| sonnet-4.6 | anthropic | `claude-sonnet-4-6` |

> Note: running the Anthropic candidates requires `ANTHROPIC_API_KEY`. That is a
> deliberate extension of the harness beyond the NIM-only v1 spec (which
> explicitly forbade reading that key) so Claude models could compete
> head-to-head.

## Dataset

10 curated recipe URLs ([`urls.txt`](urls.txt)) covering different cuisines and
formats. **6 fetched, 4 skipped** (Readability/fetch failed — recorded, not
counted against any model):

- Fetched: BBC Good Food (chocolate cake), Bon Appetit (BA's cookies),
  Food Network (Ina Garten roast chicken), Taste of Home (banana bread),
  Delish (French toast), King Arthur (easiest loaf of bread).
- Skipped: Smitten Kitchen, Serious Eats, Allrecipes, Epicurious.

## Leaderboard

| Model | schema_ok | latency p50 | overall | completeness | fidelity | format |
|-------|-----------|-------------|---------|--------------|----------|--------|
| sonnet-4.6 | 6/6 | 13715 ms | 4.0 | 4.2 | 4.3 | 5.0 |
| haiku-4.5 | 5/6 | 7485 ms | 4.2 | 4.3 | 4.5 | 4.3 |
| llama-3.1-8b | 4/6 | 10024 ms | 3.0 | 3.5 | 3.2 | 3.0 |
| nemotron-70b | 0/6 | — | 1.0 | 1.0 | 1.0 | 1.0 |
| qwen2.5-72b | 0/6 | — | 1.0 | 1.0 | 1.0 | 1.0 |
| mixtral-8x22b | 0/6 | — | 1.0 | 1.0 | 1.0 | 1.0 |
| llama-3.3-70b | 0/6 | 90000 ms | 1.3 | 1.5 | 1.5 | 1.0 |

Full per-URL raw outputs and per-output judge notes: [`run-report.md`](run-report.md).
Structured scores: [`judgments.json`](judgments.json).

## Why the NIM models failed

- `nemotron-70b` and `qwen2.5-72b` → **http_404** ("Not found for account…") —
  the model id is not available on this NVIDIA account/tier (deprecated, or
  behind a different access path).
- `mixtral-8x22b` → **http_500** ("EngineCore … Internal Server Error").
- `llama-3.3-70b` → **timeout** at 90 s on 4/6 URLs; on the 2 it answered, it
  violated the BCP-47 `source_language` constraint (returned `"English"`).
- `llama-3.1-8b` was the lone NIM survivor: schema 4/6 (the 2 fails are all
  `source_language="English"`), mid quality, and prone to inventing Toll-House
  defaults when the source is narrative rather than a structured ingredient list.

This is an **access/availability finding more than a quality finding** — before
ruling out open-weight NIM models, the model ids and account entitlements need
to be re-checked.

## Cross-cutting signals (feed back into the prompt or schema)

1. **`source_language` BCP-47 enforcement is brittle.** Both Llama models
   returned `"English"` instead of `"en"`, failing the `^[a-z]{2}(-[A-Z]{2})?$`
   regex. Options: tighten the prompt with an explicit example list, or add a
   post-parse normalizer (`English` -> `en`, `francais` -> `fr`, …). Several of
   llama-3.1-8b's schema-fails would flip to passes with this alone.
2. **`servings` cannot be `null`** (schema requires int 1-200), but Haiku
   correctly returned `null` when the source had no servings (BA cookies).
   Consider relaxing to `servings: number | null` — these outputs are user-edited
   drafts.
3. **The 2000-char source excerpt may not contain the recipe.** BA cookies'
   first 2000 chars are tip prose; the ingredient block is further down. Models
   that returned empty `ingredients[]` (Sonnet, Haiku) were arguably more honest
   than llama-3.1-8b's invented list. The excerpt window (and what we feed the
   model) is worth revisiting.
4. **Output code-fences slip past the prompt.** Haiku consistently wrapped JSON
   in ```` ```json … ``` ```` despite the "no code fences" rule. The harness's
   fence-strip catches it; production Anthropic calls would need the same
   handling. (Production today is NIM-only with `response_format: json_object`,
   so this only surfaces in the eval.)

## Suggested next round

- **Fix the NIM model ids / entitlements** and re-run, so the open-weight tier
  is actually evaluated rather than 404'd.
- **Add a `source_language` normalizer** (or prompt examples) and measure the
  schema-pass lift.
- **Decide on `servings: number | null`.**
- **Repair the 4 fetch failures** (extraction fallback) and grow the sample.
- **`repeat>1`** for latency stability; consider a cost-per-call column.

## Files in this round

| File | What it is |
|------|------------|
| [`README.md`](README.md) | This writeup. |
| [`run-report.md`](run-report.md) | Full machine-generated run: per-URL source excerpt, every model's raw JSON, auto metrics, and per-output judge block. |
| [`judgments.json`](judgments.json) | Structured judge scores, keyed `[url_index][model_label]`. |
| [`apply-judgments.ts`](apply-judgments.ts) | One-off script that merged `judgments.json` into `run-report.md`'s placeholders. |
| [`urls.txt`](urls.txt) | The 10 input URLs (6 fetched, 4 skipped). |
