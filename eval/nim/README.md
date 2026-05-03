# NIM Eval Harness

Compares candidate models on Dishton's `structuringFromHtml` prompt.
Supports two providers: NVIDIA NIM and Anthropic Claude. Mix and match
in the candidate list.

See spec: `docs/superpowers/specs/2026-05-03-nim-eval-harness-design.md`.

## Quick start

1. Copy `urls.txt.example` to `urls.txt` and add recipe URLs.
2. Edit `models.ts` to set the candidate list. Each candidate has a
   `provider: 'nim' | 'anthropic'` field.
3. Add API keys to `.env` at the repo root. Only the keys for providers
   actually used by your candidate list are required:
   - `NVIDIA_API_KEY=nvapi-...` — required if any candidate has `provider: 'nim'`
   - `ANTHROPIC_API_KEY=sk-ant-...` — required if any candidate has `provider: 'anthropic'`
4. Run: `pnpm eval:nim`
5. Open the latest file under `eval/nim/runs/` and ask Claude Code:
   *"judge the latest run"*. The session reads the report, fills in
   the `TBD` rubric placeholders, and writes a leaderboard at the top.

## CLI flags

- `--repeat N` — repeat each (URL, model) call N times; latency is the median
- `--concurrency N` — bounded URL fan-out per model (default 2)
- `--out <path>` — override report output path
- `--dry-run` — validate config + URL list + env keys, do not call any model
