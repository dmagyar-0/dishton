# Round 2 — model / mode / prompt eval

**Date:** 2026-06-01 · **Prompt under test:** production `structuringFromHtml` / `structuringFromCaption` / `structuringFromImage` (`supabase/functions/_shared/ai/prompts.ts`), via **forced `extract_recipe` tool use + prompt caching** (matches production). Harness + methodology: [`PLAN.md`](PLAN.md).

## TL;DR

- **The hard cookbook-matrix photo is solved by using a bigger model with thinking OFF.** Production `haiku` fails it badly (wrong dish, mixed all three columns, hallucinated ingredients). `sonnet` (no thinking) and `opus` (no thinking) both nail it — correct dish, 100% of the expected ingredients, clean column isolation, all 10 steps.
- **Adaptive thinking does *not* help here and actively hurts.** `sonnet-think` matches `sonnet` at ~2× latency/cost; `opus-think` is the worst config on the photo — one of three runs blew through `max_tokens` (14.9k output tokens, 210 s, truncated → schema fail) and another pulled 7 ingredients from the wrong columns.
- **Captions and URLs are solved for the quality tier** — all five configs pass every Stage-2 caption (incl. Hungarian units: `50 dkg`→500 g, `3 dl`→300 ml, `ek`/`tk`, `gerezd`→count), and on URLs sonnet/opus/sonnet-think/opus-think are 6/6 while haiku is 5/6.
- **Recommendation:** keep `claude-haiku-4-5` for the text/caption lanes; **route the photo/vision lane to `claude-sonnet-4-6` (no thinking)** — it fixes the matrix case for ~$0.07/photo-import (vs $0.02 on haiku, $0.21 on opus). Do **not** enable adaptive thinking for extraction. See [Recommendation](#recommendation).

## Configs (the 5-grid)

| label | model | thinking | effort | tool_choice |
|---|---|---|---|---|
| `haiku` | claude-haiku-4-5 | off | — | force (prod today) |
| `sonnet` | claude-sonnet-4-6 | off | — | force |
| `sonnet-think` | claude-sonnet-4-6 | adaptive | medium | auto |
| `opus` | claude-opus-4-8 | off | — | force |
| `opus-think` | claude-opus-4-8 | adaptive | medium | auto |

> Thinking configs use `tool_choice: auto` (forcing a named tool is incompatible with thinking) and `effort: medium` + 20k `max_tokens` (an earlier `effort: high` pass produced 200 s+ latencies and truncated tool calls on Sonnet). Opus 4.x rejects `temperature`, so it's omitted there.

## Leaderboard — Stage 2 (captions) + Stage 3 (image), repeat 3

| config | schema_ok | p50 | $/call | $ total | s3 title | s3 recall | s3 real bleed | judged overall |
|---|---|---|---|---|---|---|---|---|
| **sonnet** | 4/4 | 23.6s | $0.045 | $0.18 | ✅ | 100% | **0** | **4.8** |
| **opus** | 4/4 | 21.1s | $0.103 | $0.41 | ✅ | 100% | **0** | **4.5** |
| sonnet-think | 4/4 | 69.5s | $0.091 | $0.37 | ✅ | 100% | 0 | 4.3 |
| haiku (prod) | 4/4 | 9.7s | $0.017 | $0.07 | ❌ | 63% | 2 | 3.0 |
| opus-think | 3/4 | 34.7s* | $0.189 | $0.76 | ✅ | 84% | 7 | 2.3 |

\* opus-think's Stage-3 median latency was **195 s** (one repeat hit 210 s and truncated). "real bleed" corrects the harness's cross-ingredient false-positive (see [Comparator fix](#comparator-fix)). `judged overall` is the 1–5 LLM-judge mean across this run's cases.

## Stage 3 — the cookbook breakdown photo (the headline)

Task: 4 photos of a 3-variant "breakdown" table (Shepherdless | **Sweet Potato Cottage Pie** | Fishless) + shared method, with the note *"use only the middle column."* This is the case the user reported as failing.

| config | title | recall | real bleed | C / F / Fmt | overall | what happened |
|---|---|---|---|---|---|---|
| haiku | ❌ "Shepherd's Pie" | 63% | 2 (celery, parsley) | 2/1/2 | **2** | Mixed all three columns; hallucinated "6 eggs fried in white", "100g sample", "3 spring greens", "2 bay leaves". The exact failure reported. |
| **sonnet** | ✅ | 100% | 0 | 4/5/5 | **5** | Correct dish; every section (Base/Core/Beans/Sauce/Seasoning/Topping/Serve); 10 steps; even rewrote the shared method to drop the Fishless wine/cashew line. |
| **opus** | ✅ | 100% | 0 | 4/4/5 | **4** | Correct & clean, but left the Fishless "add the wine… cashew cream" conditional in step 5, and rendered the tins as `count` not `400 g`. |
| sonnet-think | ✅ | 100% | 0 | 4/5/4 | **4** | Same quality as `sonnet` at ~2× cost/latency (88 s, 7.5k output tokens). Thinking bought nothing. |
| opus-think | ✅ / truncated | 84% | 7 | 2/2/1 | **2** | Unreliable: 1 of 3 runs truncated at `max_tokens` (210 s, schema fail); another bled onion, celeriac, oyster mushroom, wine, cashew, red chilli from the other two columns. |

**Verdict:** a bigger model with **thinking off** is what cracks the matrix. `sonnet` is the sweet spot (same result as `opus`, 1/3 the cost). Thinking degrades this structured-extraction task — the model over-explores the table and either runs out of output budget or reasons itself into adjacent columns.

**Nuance worth noting:** even `sonnet`/`opus` dropped the **`750 g` plain potatoes** from the topping (it's *both* 750 g potatoes *and* 750 g sweet potatoes) — despite the prompt's explicit "plain potatoes appearing inside a Sweet Potato variant's topping" line. A candidate R2.1 prompt tweak. (`recall: 100%` didn't catch this because "potatoes" is a substring of "sweet potatoes" — a known limit of term-matching; the gold is also DRAFT, see caveats.)

## Stage 2 — captions (Instagram + complex)

**Every config passed schema on all three captions.** This lane is not a differentiator — it's a regression check, and it holds.

- **`hu-langos` (Hungarian):** all five got `source_language: hu`, converted `50 dkg`→500 g, `3 dl`→300 ml, `ek`→tbsp, `gerezd`→count, and `kb. 8 db`→servings 8. The unit-translation prompt rules work across the board, even the unusual decagram.
- **`sectioned-lasagna`:** all preserved the 3 sub-sections, handled the `1-2 tbsp` range (lower bound + range in notes), `handful`/`pinch` non-scalables, and added °F to the 180 °C bake.
- **`zingy-lime-cheesecake`:** all 16 ingredients across 3 sections; ranges and the optional blueberries handled. Minor model-to-model differences: `sonnet` infers `servings: 8` while the others default to `1` (the prompt says default to 1 when unstated — so `haiku`/`opus` are strictly more correct); conversion style varies (fractions-as-`cup_us` vs converted to ml/g).

Judged overall for Stage 2: `opus` 5.0, `sonnet` 4.8, `haiku` 4.3, `sonnet-think` 4.3, `opus-think` 4.3 — all comfortably usable.

## Stage 1 — URL regression (repeat 1)

6 of the 10 curated URLs fetched; 4 are blocked at the fetch layer (Smitten Kitchen, Serious Eats, Allrecipes, Epicurious — anti-bot / Readability failures, same as round 1, **not** a model issue).

| config | schema_ok | p50 | $/call |
|---|---|---|---|
| sonnet | 6/6 | 30s | $0.131 |
| opus | 6/6 | 21s | $0.266 |
| sonnet-think | 6/6 | 97s | $0.195 |
| opus-think | 6/6 | 42s | $0.302 |
| haiku (prod) | 5/6 | 15s | $0.046 |

All quality-tier models extract URLs cleanly. `haiku` is the only config that fails — a recurring `steps (invalid_type)` schema error on the Food Network (Ina Garten) page in **both** runs, so it's a genuine (if rare) haiku reliability edge, not noise. Thinking adds no schema benefit (non-thinking sonnet/opus are already 6/6) at 2–4× the latency — `sonnet-think` is especially slow (97 s p50). Net: URL extraction is solved; nothing here changes the recommendation.

## Cost & time

Real per-call cost (repeat 3 means prompt caching kicks in after the first call per model → later cases are much cheaper; `input` tokens drop to ~250–300 once the system prompt is cached):

| config | caption call | image call (4 photos) | Stage 3 latency |
|---|---|---|---|
| haiku | ~$0.011–0.016 | $0.026 | 22 s |
| sonnet | ~$0.027–0.045 | $0.074 | 47 s |
| sonnet-think | ~$0.05–0.10 | $0.140 | 88 s |
| opus | ~$0.050–0.086 | $0.211 | 34 s |
| opus-think | ~$0.07–0.12 | $0.496 | **195 s** |

- **Opus delta:** ~5–6× haiku per token ($5/$25 vs $1/$5 per 1M). In absolute terms a photo-import is $0.21 on opus vs $0.07 on sonnet vs $0.02 on haiku — pennies either way.
- **Thinking tax:** adaptive thinking multiplies output tokens (and thus cost + latency) 2–3× with **no quality gain** on these tasks, and on the photo it caused outright failure.
- **Whole Stage 2+3 sweep (60 calls, repeat 3) cost ~$1.78; Stage 1 (30 calls, repeat 1) ~$5.6.** Clean R2.0 total ≈ **$7.4** — within the ~$10–25 plan estimate. (The first pass also burned ~$5 before the key's credit ran out mid-run — the harness now aborts on that error.)

## Adaptive thinking — verdict

For strict structured extraction into a fixed tool schema, **leave adaptive thinking off.** Findings:
- No quality lift on any stage (captions identical; image: `*-think` ≤ non-think).
- 2–3× latency and cost.
- On the hardest case it *introduced* failures: `opus-think` truncated at `max_tokens` (thinking ate the output budget) and bled across columns; `sonnet-think` at `effort: high` ran 200 s+ on full HTML.
- This matches the model guidance that thinking suits open-ended reasoning, not constrained schema-filling — here it over-explores instead of just following the matrix-guard rule.

## Recommendation

1. **Text + caption lanes:** keep `claude-haiku-4-5` (current prod). Fast, cheap, passes everything tested.
2. **Photo / vision lane:** switch from `haiku` to **`claude-sonnet-4-6`, thinking off**. It's the only change that fixes the multi-column matrix photo, at ~$0.07/import. `opus` is equally correct but 3× the cost for no benefit. `client.ts` already carries a `lane: 'text' | 'vision'` parameter, so this is a per-lane model override, not a global switch.
3. **Do not enable adaptive thinking** for extraction.
4. **Optional R2.1 prompt tweak:** strengthen the topping rule so the plain-potatoes line isn't dropped from variant toppings; re-run Stage 3 to measure the lift.

## Comparator fix

The automated gold-diff initially reported "bleed: black bean" for `sonnet`/`opus`/`sonnet-think` — a false positive: it matched term *words* against the whole concatenated ingredient list, so "black" (from "black pepper") + "bean" (from "green beans") matched across two different rows. Fixed to match **per-ingredient** (a forbidden term counts only if one single ingredient contains all its words); locked with a regression test. Their real bleed is **0**.

## Caveats

- **The gold is a DRAFT** read from angled photos ([`gold/sweet-potato-cottage-pie.json`](gold/sweet-potato-cottage-pie.json)); the SAUCE row is the least certain. Title-match and bleed are robust regardless; recall depends on the gold being right. Worth a human confirm against the book.
- `repeat 3` on one photo is a small sample — enough to show `haiku` fails and `sonnet`/`opus` succeed, and to expose `opus-think`'s instability, but not a precise success-rate.

## Reproduce

See [`PLAN.md` → How to run](PLAN.md). Raw per-run reports (with every model's full output + judge blocks) are in [`runs/`](runs/): `r2.0-stage23.md` (this analysis), `r2.0-stage1.md` (URL regression), `r2.0-baseline.md` (the first, credit-truncated pass).
