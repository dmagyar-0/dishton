# Evaluations

Committed record of model/prompt evaluation rounds for Dishton's AI extraction
prompts. Each round runs a curated set of recipe inputs through several
candidate models on the **production** prompt, measures schema-pass rate /
latency / tokens automatically, and has a Claude Code session judge each output
on a 1-5 rubric. Results live here so they survive and stay diff-able over time.

The prompt under evaluation is the real one — the harness imports
[`structuringFromHtml`](../supabase/functions/_shared/ai/prompts.ts) directly,
so a prompt change is automatically reflected in the next run.

## Rounds

| Round | Date | Scope | Sample | Headline |
|-------|------|-------|--------|----------|
| [Round 1](round-1/README.md) | 2026-05-03 | `structuringFromHtml` (URL, text lane) | 7 models x 6 recipes | `claude-haiku-4-5` best value; `claude-sonnet-4-6` quality reference; 4 of 5 NIM models failed on access (404/500/timeout), not quality. |
| [Round 2](round-2/README.md) | 2026-06-01 | URL + caption + cookbook-matrix photo | 5 configs (Haiku 4.5 / Sonnet 4.6 / Opus 4.8 ± thinking) | Vision lane → `claude-sonnet-4-6`; text stays Haiku 4.5; adaptive thinking off. |
| [Round 3](round-3/README.md) | 2026-10-08 | URL + caption (text lane) | Haiku 5.5 (subagent stand-in) × 10 text + 2 photo cases | Text lane → `claude-haiku-5-5` (~1/10 cost, no regression after 2 prompt rules); prompt caching removed. Photos: Sonnet 5.5 clean 6/6 and ~10–30% cheaper than Sonnet 4.6; Haiku 5.5 ~20× cheaper still, minor slips in 3/6. Vision lane not switched yet. |

## How a round is laid out

- `round-N/README.md` — the investigation: what was tested, the leaderboard,
  findings, and follow-ups.
- `round-N/run-report.md` — the full machine-generated run (per-URL source
  excerpt, every model's raw JSON output, auto metrics, per-output judge notes).
- `round-N/judgments.json` — structured judge scores.
- `round-N/urls.txt` — the input set used.

## The harness

The Deno CLI that produces these runs lives in [`eval/nim/`](nim/). Design notes:
[spec](../docs/superpowers/specs/2026-05-03-nim-eval-harness-design.md),
[plan](../docs/superpowers/plans/2026-05-03-nim-eval-harness.md). Its own
`eval/nim/urls.txt` and `eval/nim/runs/` are gitignored (scratch space), which is
why finalized rounds are curated into committed `eval/round-N/` folders like this
one.
