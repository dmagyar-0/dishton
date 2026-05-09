# NIM Eval Harness

Compares candidate models on Dishton's `structuringFromHtml` prompt.
Supports two providers: NVIDIA NIM and Anthropic Claude. Mix and match
in the candidate list.

See spec: `docs/superpowers/specs/2026-05-03-nim-eval-harness-design.md`.

## Quick start

1. Copy `urls.txt.example` to `urls.txt` and add recipe URLs. Instagram URLs
   (`instagram.com/...`) can be mixed in with regular HTML recipe URLs — see
   "Instagram support" below.
2. Edit `models.ts` to set the candidate list. Each candidate has a
   `provider: 'nim' | 'anthropic'` field.
3. Add API keys to `.env` at the repo root. Only the keys for providers
   actually used by your candidate list are required:
   - `NVIDIA_API_KEY=nvapi-...` — required if any candidate has `provider: 'nim'`
   - `ANTHROPIC_API_KEY=sk-ant-...` — required if any candidate has `provider: 'anthropic'`
   - `IG_OEMBED_TOKEN=...` — *optional*, only used if you have Instagram URLs
     and want richer captions via Facebook Graph oEmbed. Without it the harness
     falls back to scraping `og:title` / `og:description` from the public page,
     which is the same fallback production uses.
4. Run: `pnpm eval:nim`
5. Open the latest file under `eval/nim/runs/` and ask Claude Code:
   *"judge the latest run"*. The session reads the report, fills in
   the `TBD` rubric placeholders, and writes a leaderboard at the top.

## Instagram support

Instagram URLs are auto-detected by host (`instagram.com` or any subdomain)
and routed through the same caption-fetch pipeline as the production
`import-instagram` Edge Function. The shared helper lives at
`supabase/functions/_shared/scrape/instagram-caption.ts` so the eval and
production never drift.

For each Instagram URL the harness:

1. Calls `fetchInstagramCaption()` — oEmbed if `IG_OEMBED_TOKEN` is set,
   otherwise scrape `og:title` / `og:description` / `og:image`.
2. Builds the caption string `${title}\n\n${stripped(description)}` —
   identical to what production sends to the model.
3. Prompts each candidate with `structuringFromCaption` (not
   `structuringFromHtml`).

Failure modes appear in the *Skipped URLs* section of the report:
- `instagram_unavailable` — both oEmbed and OG fallback returned no caption
  (login-walled, deleted post, or aggressive bot blocking).
- `timeout` — caption fetch took longer than 10 s.
- `network` — connection error.

## CLI flags

- `--repeat N` — repeat each (URL, model) call N times; latency is the median
- `--concurrency N` — bounded URL fan-out per model (default 2)
- `--out <path>` — override report output path
- `--dry-run` — validate config + URL list + env keys, do not call any model
