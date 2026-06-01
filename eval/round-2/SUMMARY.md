# Round 2 eval — findings summary

**What we did:** ran the production recipe-import prompts through a 5-config grid —
Haiku 4.5, Sonnet 4.6, Opus 4.8, each ± adaptive thinking — over three stages:
simple URLs, Instagram/complex captions, and a hard cookbook "breakdown matrix"
photo (pick one of three side-by-side recipe columns). Forced `extract_recipe`
tool use + prompt caching, exactly like production. Full detail: [README.md](README.md).

## Decision shipped

**Photo/vision lane → `claude-sonnet-4-6` (thinking off); text + caption lanes stay
`claude-haiku-4-5`.** Implemented in `supabase/functions/_shared/ai/client.ts` as a
per-lane default, overridable via `ANTHROPIC_MODEL` (text) / `ANTHROPIC_MODEL_VISION`
(vision). Adaptive thinking is not used on either lane.

## Why — the matrix photo

This is the case production Haiku failed.

| config | result on the photo | $/photo | latency |
|---|---|---|---|
| Haiku 4.5 (old prod) | ❌ wrong dish, all 3 columns mixed, hallucinated items | $0.026 | 22 s |
| **Sonnet 4.6 (new prod)** | ✅ correct dish, 100% of ingredients, 0 column-bleed | $0.074 | 47 s |
| Opus 4.8 | ✅ equally correct | $0.211 | 34 s |
| Sonnet / Opus + thinking | no better; **Opus+thinking broke** (truncation, bleed, 195 s) | $0.14–0.50 | 88–195 s |

Sonnet matches Opus quality at ~⅓ the cost → Sonnet chosen.

## The three questions you asked

- **Opus cost:** ~5× Haiku per token, but pennies in absolute terms. Not needed —
  Sonnet already fixes the photo.
- **Opus time:** ~1.5–2× Haiku; with thinking it ballooned to ~195 s on the photo.
- **Adaptive thinking:** no quality lift on any stage, 2–3× cost/latency, and it
  *caused* failures on the hardest case → **leave it off.**

## Other findings

- **Captions + URLs are solved for every config** (incl. Hungarian units `50 dkg`→500 g
  / `ek`/`tk`/`gerezd`, and multi-section recipes with ranges). Haiku stays there —
  cheap and fast. Its only blemish: a rare `steps` schema error on one URL.
- **An R2.1 prompt tweak was tested and rejected** — a "never drop a line" rule
  *increased* column bleed (for matrix extraction, selectivity beats exhaustiveness).
- **Two harness bugs found & fixed:** a gold-diff cross-ingredient false positive,
  and thinking-config truncation/latency at `effort: high`.
- **Total clean eval spend ≈ $7.4** (the first pass also burned ~$5 before the API
  key's credit ran out mid-run; the harness now aborts on that error).

## Verification

Edge-function suite green (95 tests); `client.ts` type-checks. The change is
configuration-only (model id per lane) — no prompt or schema change.

## Follow-ups (optional)

- Confirm the drafted gold's SAUCE row against the book to firm up recall numbers.
- Consider raising the vision-lane timeout headroom if you ever route it to Opus or
  enable thinking (Sonnet-no-thinking stays well under the current 90 s).
