# Round 2 — Eval Plan: model / mode / prompt sweep

> Status: **PLAN — scope confirmed; awaiting fixtures + API key.** Working folder: `eval/round-2/`.
> This file is the setup plan; the final write-up will land in `eval/round-2/README.md` after the runs.
>
> **Locked decisions:** (Q1) Recommended 5-config grid · (Q2) Gold-diff + LLM judge · (Q3) Match production (forced `extract_recipe` tool use + prompt caching).

## Context — why we're doing this

Round 1 (2026-05-03, see [`eval/round-1/README.md`](../round-1/README.md)) compared NIM open-weight models against Claude (Haiku 4.5, Sonnet 4.6) on the **URL text lane** (`structuringFromHtml`) over 6 recipe URLs, judged 1–5 by an interactive Claude session. Conclusions: Haiku 4.5 = best value, Sonnet 4.6 = quality reference, NIM mostly unavailable (404/500/timeout).

Production today (`supabase/functions/_shared/ai/client.ts`) runs **`claude-haiku-4-5`**, **no extended thinking**, forced `extract_recipe` tool use, prompt caching on the system block.

Round 2 (this request) extends the eval to answer four things:
1. A **staged** test suite — Stage 1 easy (regression), Stage 2 edge cases (Instagram + complex multi-section recipes), Stage 3 hard (the cookbook "breakdown matrix" photos that currently fail even with a "use only the middle column" hint).
2. Whether **Opus 4.8** is worth using — quantify the extra **cost** and **time**.
3. Whether **adaptive thinking** helps.
4. Run several rounds varying model / mode / prompt, then produce a report.

## What we reuse from round 1

- **Harness** (`eval/nim/`, Deno): `run.ts` (URL lane), `caption.ts` (Instagram lane), `models.ts` (candidate list), `anthropic.ts` (Anthropic adapter), `report.ts` (tables + markdown), `fetch.ts`, schema validation against the canonical `Recipe` Zod schema (`src/domain/recipe.ts`).
- **Inputs**: [`eval/round-1/urls.txt`](../round-1/urls.txt) (6 working URLs) → Stage 1. [`eval/nim/captions/zingy-lime-cheesecake.txt`](../nim/captions/zingy-lime-cheesecake.txt) → Stage 2 seed.
- **Prompts under test** (`supabase/functions/_shared/ai/prompts.ts`): `structuringFromHtml`, `structuringFromCaption`, `structuringFromImage`. Note: the image prompt **already** contains a matrix-guard rule ("if a photograph shows multiple recipe variants side-by-side as a matrix… extract ONLY that variant's column") and even references the Sweet-Potato / "plain potatoes" case. Round 2 measures whether it actually works, per model/mode.

## Facts that shape the build (verified via `claude-api` skill, pricing cached 2026-05-26)

- **Pricing /1M tokens**: Haiku 4.5 **$1 / $5**, Sonnet 4.6 **$3 / $15**, **Opus 4.8 $5 / $25**. Opus is ~5× Haiku — far cheaper than the historic $15/$75.
- **Adaptive thinking**: Opus 4.8 / Sonnet 4.6 use `thinking: {type: "adaptive"}`. On **Opus 4.8, `budget_tokens` AND `temperature`/`top_p`/`top_k` all return HTTP 400.** → the current `anthropic.ts` always sends `temperature: 0.1`, which will **400 on Opus** — must be made conditional.
- **Effort**: `output_config: {effort: "low"|"medium"|"high"|"max"}` (Opus 4.5+, Sonnet 4.6). **Errors on Haiku 4.5.** `max`/`xhigh` are Opus-only.
- **Thinking tokens bill as output tokens** and need `max_tokens` headroom → raise from 4096 to ~16k; stream if >16k.

## Harness (self-contained in `eval/round-2/`)

Built fresh under `eval/round-2/` rather than mutating legacy `eval/nim/` — that adapter imports a since-renamed `NimMessage` type and calls `structuringFromHtml` with a stale signature, so it no longer type-checks. Round 2 imports the *current* production prompts, schema, and tool definition directly.

- **`anthropic.ts`** — raw-HTTP adapter. Forced `extract_recipe` tool use + prompt caching (matches prod); omits `temperature` for Opus/thinking (Opus 4.x returns 400 on it); `thinking:{type:"adaptive"}` + `output_config:{effort}` passthrough; `tool_choice:auto` when thinking is on (forcing a named tool is incompatible with thinking); captures input/output/cache-read/cache-write tokens.
- **`models.ts`** — the 5-config grid (`haiku`, `sonnet`, `sonnet-think`, `opus`, `opus-think`). *(Q1: recommended grid)*
- **`cost.ts`** — price table (Haiku $1/$5, Sonnet $3/$15, Opus $5/$25) + per-call USD incl. cache discounts.
- **`cases.ts`** — staged cases for all three lanes (url/caption/image); reuses production prompt builders; base64-encodes local photos into the real image prompt.
- **`score.ts`** — Zod schema validation + gold-diff: recall, foreign-column **bleed**, title match, step coverage. *(Q2: gold-diff + LLM judge)*
- **`report.ts`** / **`run.ts`** — markdown report (cost + gold-diff + TBD judge placeholders) and orchestrator.
- **`*_test.ts`** — 11 unit tests (cost math, schema/gold-diff, adapter body via mock fetch).
- Fixtures: `fixtures/captions/` (hu-langos, sectioned-lasagna), `fixtures/images/shepherdless-pie/` (your 4 photos); `gold/sweet-potato-cottage-pie.json` (DRAFT — needs your verification, esp. the SAUCE row).

## Test suite (`eval/round-2/fixtures/`)

- **Stage 1 — Simple (regression):** the 6 working round-1 URLs. Expect all quality-tier models to pass; guards against regressions.
- **Stage 2 — Edge cases:**
  - Instagram captions: existing cheesecake + ~3 harder ones (multi-section, non-English/Hungarian units, heavy hashtag/emoji noise, missing quantities/servings).
  - Complex URLs: 1–2 multi-section recipes (sub-headings, quantity ranges, fractions).
- **Stage 3 — Hard images (the attached cookbook breakdown):**
  - `images/shepherdless-pie/` = 4 photos: method p.1 (steps 1–6), method p.2 (steps 7–10), breakdown spread 1, breakdown spread 2. Note: *"use only the middle column (Sweet Potato Cottage Pie)."*
  - **Gold** = hand-authored Sweet Potato Cottage Pie recipe = middle column across all 7 sections (BASE VEG, CORE VEG, BEANS/LENTILS, SAUCE, SEASONING, MASHED POTATO TOPPING, TO SERVE) + the shared 10 steps. **Needs your verification against the book** (OCR from angled photos is error-prone).
  - **Pass criteria:** every middle-column ingredient present; **no bleed** from the Shepherdless / Fishless columns; sections preserved; all 10 steps; oven temps in °C + °F.
  - Optional: 1–2 single-recipe control photos to confirm simple vision didn't regress.

> ⚠️ **Dependency:** I can't export the images you pasted into the chat to disk. Please save the 4 photos into `eval/round-2/fixtures/images/shepherdless-pie/` (any order; I'll wire up the loader).

## Run matrix *(Q1: confirmed — recommended 5-config grid)*

| Config | Model | Thinking | Effort | Role |
|---|---|---|---|---|
| `haiku` | `claude-haiku-4-5` | off | — | **baseline = prod today** |
| `sonnet` | `claude-sonnet-4-6` | off | — | mid tier |
| `sonnet-think` | `claude-sonnet-4-6` | adaptive | high | thinking effect, mid tier |
| `opus` | `claude-opus-4-8` | off | medium | top tier, no thinking |
| `opus-think` | `claude-opus-4-8` | adaptive | high | top tier + thinking |

`repeat = 3` (latency/variance), `concurrency = 2–4`, `timeout = 300s` (thinking + vision can be slow).

## Cost & time estimate (new pricing)

Per-call (text: ~3k in / ~2k out; +3k thinking tokens where on):

| Config | Text call | Vision call (4 imgs) |
|---|---|---|
| haiku | ~$0.013 | ~$0.02 |
| sonnet | ~$0.04 | ~$0.07 |
| sonnet-think | ~$0.08 | ~$0.14 |
| opus | ~$0.065 | ~$0.13 |
| opus-think | ~$0.14 | ~$0.28 |

- **Full sweep** (~15 inputs × 5 configs × repeat 3, plus LLM-judge): **≈ $10–25 total.** Opus adds pennies per call, not dollars.
- **Latency**: Haiku ~7s, Sonnet ~14s, Opus ~15–25s, **Opus+thinking (vision) up to ~60–120s.** Full pass ≈ **20–45 min** at concurrency 2–4.

## Scoring *(Q2: confirmed — gold-diff + LLM judge)*

- **Automated**: `schema_ok` (Zod), latency p50/p95, tokens, **cost**, and **gold-diff** (ingredient-set / section / step coverage; any foreign-column ingredient = fail) for cases with a gold.
- **LLM-judge** (as round 1): completeness / fidelity / format / overall (1–5) on outputs without a gold.

## Rounds

- **R2.0** baseline: current prompt, all configs, all stages → leaderboard.
- **R2.1** prompt tweak: strengthen the matrix-guard / column-selection wording; re-run Stage 3 + Stage 1 regression.
- **R2.2** finalize: best model/mode + prompt, confirm on full suite.

Each round appends to `eval/round-2/` (`run-report-*.md`, `judgments-*.json`).

## Final report → `eval/round-2/README.md`

Leaderboard (schema / quality / latency / **cost**), per-stage analysis, the headline question *"does Opus and/or thinking fix the matrix photo?"*, the cost & time delta of Opus and of thinking, a recommended production config (model + mode + any prompt change), and follow-ups.

## How to run

```bash
pnpm test:eval:round2                    # 11 unit tests (no network)
pnpm eval:round2:dry                     # list the full matrix, no API calls
pnpm eval:round2 -- --smoke              # 1 cheap live call (haiku, one caption)
pnpm eval:round2 -- --repeat 1           # full R2.0 sweep (5 configs × all stages)
pnpm eval:round2 -- --stage 3 --repeat 3 # focused Stage-3 (the matrix photo)
```

Note: deno's `--env-file=.env` does not populate the key on this CRLF `.env`, so `run.ts` parses `.env` itself as a fallback (expects `ANTHROPIC_API_KEY=...`). Run reports land in `eval/round-2/runs/`.
