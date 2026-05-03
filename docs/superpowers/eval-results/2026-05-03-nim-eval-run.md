# NIM Eval Run — 2026-05-03T18:39:15.239Z

## Summary findings (judge: this Claude Code session)

**Sample:** 7 candidate models × 6 successfully-fetched recipes (4 of 10 URLs failed Readability fetch — Smitten Kitchen, Serious Eats, Allrecipes, Epicurious — listed under Skipped URLs at the bottom).

### Recommendation
- **`claude-haiku-4-5` is the best overall value.** Highest judged overall (4.2/5), tied-best fidelity (4.5/5), strong format hygiene (4.3/5), and clearly the fastest of the quality tier (p50 **7.5 s**, p95 12.8 s). The one schema-fail (BA cookies, `servings=null` violating the int-1-200 constraint) reflects an honest "no ingredient list in source" response rather than hallucination.
- **`claude-sonnet-4-6` is the quality reference / safety net.** Perfect 6/6 schema, perfect format hygiene (5.0), slightly lower completeness (4.2) — Sonnet was the only working model that *missed yeast and salt* on the King Arthur bread (3 ingredients vs. Haiku's 7). Pay ~2x latency (p50 13.7 s) for the format guarantee.
- **NIM open-weight access is the bigger problem than quality.** 4 of 5 NIM candidates failed to produce any output: `nvidia/llama-3.1-nemotron-70b-instruct` and `qwen/qwen2.5-72b-instruct` returned **http_404** (id not on this account/tier — possibly deprecated or behind a different access path), `mistralai/mixtral-8x22b-instruct-v0.1` returned **http_500** (NIM EngineCore Internal Server Error), and `meta/llama-3.3-70b-instruct` either timed out at 90 s (4/6 URLs) or violated the BCP-47 source_language constraint (2/6).
- **`meta/llama-3.1-8b-instruct` is the only NIM model that worked end-to-end** — schema-passes 4/6 (fails are `source_language='English'` instead of `'en'`), p50 10 s. Quality is mid (overall 3.0) with a tendency to invent Toll-House defaults when the source is narrative (Bon Appetit cookies). Not a reliable production replacement.

### Cross-cutting issues found by the eval (signals to feed back into the prompt or schema)
1. **`source_language` BCP-47 enforcement is brittle.** Both Llama models returned `"English"` instead of `"en"`, failing the `^[a-z]{2}(-[A-Z]{2})?$` regex. Either tighten the prompt with an explicit example list, or add a post-parse normalizer (`English` → `en`, `francais` → `fr`, ...).
2. **`servings` cannot be `null`** but Haiku correctly returned null when the source omitted it (BA cookies). Consider relaxing to `servings: number | null` — the production import already calls these "drafts" the user edits.
3. **Source excerpts may not contain the recipe.** Bon Appetit cookies' first 2000 chars are tip prose; the actual ingredient block is later. Models that returned empty `ingredients[]` (Sonnet, Haiku) were arguably more honest than Llama-3.1-8b's invented Toll-House list.
4. **Output fences slip past the prompt.** Haiku consistently wrapped JSON in `\`\`\`json ... \`\`\`` despite the "no code fences" instruction; the harness's fence-strip catches this, but production Anthropic calls would need the same handling. (Production already uses NIM-only with `response_format: json_object`, so this surfaces only in the eval.)

## Leaderboard

| Model | schema_ok | latency p50 | overall | completeness | fidelity | format |
|-------|-----------|-------------|---------|--------------|----------|--------|
| sonnet-4.6 | 6/6 | 13715 ms | 4.0 | 4.2 | 4.3 | 5.0 |
| haiku-4.5 | 5/6 | 7485 ms | 4.2 | 4.3 | 4.5 | 4.3 |
| llama-3.1-8b | 4/6 | 10024 ms | 3.0 | 3.5 | 3.2 | 3.0 |
| nemotron-70b | 0/6 | 0 ms | 1.0 | 1.0 | 1.0 | 1.0 |
| qwen2.5-72b | 0/6 | 0 ms | 1.0 | 1.0 | 1.0 | 1.0 |
| mixtral-8x22b | 0/6 | 0 ms | 1.0 | 1.0 | 1.0 | 1.0 |
| llama-3.3-70b | 0/6 | 90000 ms | 1.3 | 1.5 | 1.5 | 1.0 |

## Run config
- Started:     2026-05-03T18:39:15.239Z
- Finished:    2026-05-03T18:46:06.086Z
- Models:      nemotron-70b, llama-3.3-70b, qwen2.5-72b, mixtral-8x22b, llama-3.1-8b, haiku-4.5, sonnet-4.6
- URLs:        6
- Concurrency: 2
- Repeat:      1
- Timeout:     90000 ms

## Per-URL results

### URL 1 — https://www.bbcgoodfood.com/recipes/easy-chocolate-cake

**Source excerpt** (first 2000 chars of cleaned text):

```
Skip to main contentHomeRecipesEasy chocolate cakeSkip to ingredientsNutrition: Per serving (14)kcal523fat29gsaturates18gcarbs59gsugars47gfibre2gprotein6gsalt0.6gMethodstep 1Heat oven to 190C/170C fan/gas 5. Butter the base and sides of two 20cm round sandwich tins and line the bases with baking parchment.step 2In a large bowl, beat together 200g golden caster sugar, 200g softened unsalted butter, 4 large eggs, 200g self-raising flour, 2 tbsp cocoa powder, 1 tsp baking powder, ½ tsp vanilla extract, 2 tbsp milk and a pinch of salt until pale.step 3Divide the mixture between the prepared tins. Bake for 20 mins or until a skewer inserted into the centre of the cake comes out clean.step 4Leave to cool in the tin for 10 mins, then turn out onto a wire rack to cool completely.step 5For the buttercream, put 100g chopped milk chocolate in a heatproof bowl and melt in the microwave, stirring every 30 secs. Leave the melted chocolate to cool for 5 mins.step 6Mash 200g softened butter and 400g icing sugar together with a fork, then switch to a wooden spoon or electric beaters, if you have them.step 7Sift in 5 tbsp cocoa powder with a pinch of salt and pour in the melted chocolate and 2 tbsp milk. Mix again until smooth.step 8On a cake stand or large plate, sandwich the cakes together with half of the buttercream, then spread the rest on top. Decorate with chocolate shards, if you like.step 9To make chocolate shards: melt 50g dark chocolate and pour it onto a tray lined with baking parchment or foil.step 10Now melt 25g milk chocolate and 25g white chocolate and drizzle them over the dark chocolate before it sets.step 11Shake the tray gently to level the mixture then leave to set somewhere cool. Chop into shards.Recipe from Good Food magazine, September 2017
```

#### Model: nemotron-70b
- schema_ok: false
- latency_ms: 0
- tokens_in: 0, tokens_out: 0
- error: http_404

**Raw output:**

```json
{"status":404,"title":"Not Found","detail":"Function '9b96341b-9791-4db9-a00d-4e43aa192a39': Not found for account 'Bdj1-MwCjvJSM-nUQGOuBcY0g5zIjBPxNfv8IJMf5Gc'"}
```

**Judge:**
- Completeness: 1
- Fidelity: 1
- Format hygiene: 1
- Overall: 1
- Notes: Model returned http_404 from NIM — id `nvidia/llama-3.1-nemotron-70b-instruct` not accessible from this account/tier. No output to evaluate.

#### Model: llama-3.3-70b
- schema_ok: false
- latency_ms: 90000
- tokens_in: 0, tokens_out: 0
- error: timeout

**Raw output:**

```json

```

**Judge:**
- Completeness: 1
- Fidelity: 1
- Format hygiene: 1
- Overall: 1
- Notes: Timed out at 90s; no output captured.

#### Model: qwen2.5-72b
- schema_ok: false
- latency_ms: 0
- tokens_in: 0, tokens_out: 0
- error: http_404

**Raw output:**

```json
404 page not found

```

**Judge:**
- Completeness: 1
- Fidelity: 1
- Format hygiene: 1
- Overall: 1
- Notes: Model returned http_404 — id `qwen/qwen2.5-72b-instruct` not on this account/tier. No output.

#### Model: mixtral-8x22b
- schema_ok: false
- latency_ms: 0
- tokens_in: 0, tokens_out: 0
- error: http_500

**Raw output:**

```json
{"error":{"message":"EngineCore encountered an issue. See stack trace (above) for the root cause.","type":"Internal Server Error","param":null,"code":500}}
```

**Judge:**
- Completeness: 1
- Fidelity: 1
- Format hygiene: 1
- Overall: 1
- Notes: NIM http_500 EngineCore Internal Server Error; no output.

#### Model: llama-3.1-8b
- schema_ok: false
- latency_ms: 13490
- tokens_in: 900, tokens_out: 1733
- error: schema: source_language

**Raw output:**

```json
{
  "title": "Easy chocolate cake",
  "description": null,
  "source_type": "url",
  "source_url": "https://www.bbcgoodfood.com/recipes/easy-chocolate-cake",
  "source_language": "English",
  "canonical_unit_system": "metric",
  "servings": 14,
  "total_time_min": null,
  "tags": [],
  "hero_image_path": null,
  "ingredients": [
    {
      "position": 1,
      "raw_text": "200g golden caster sugar",
      "quantity": 200,
      "unit": "g",
      "ingredient_name": "golden caster sugar",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 2,
      "raw_text": "200g softened unsalted butter",
      "quantity": 200,
      "unit": "g",
      "ingredient_name": "unsalted butter",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 3,
      "raw_text": "4 large eggs",
      "quantity": null,
      "unit": null,
      "ingredient_name": "eggs",
      "notes": null,
      "scalable": false,
      "non_scalable_qty": null
    },
    {
      "position": 4,
      "raw_text": "200g self-raising flour",
      "quantity": 200,
      "unit": "g",
      "ingredient_name": "self-raising flour",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 5,
      "raw_text": "2 tbsp cocoa powder",
      "quantity": null,
      "unit": null,
      "ingredient_name": "cocoa powder",
      "notes": null,
      "scalable": false,
      "non_scalable_qty": null
    },
    {
      "position": 6,
      "raw_text": "1 tsp baking powder",
      "quantity": null,
      "unit": null,
      "ingredient_name": "baking powder",
      "notes": null,
      "scalable": false,
      "non_scalable_qty": null
    },
    {
      "position": 7,
      "raw_text": "½ tsp vanilla extract",
      "quantity": null,
      "unit": null,
      "ingredient_name": "vanilla extract",
      "notes": null,
      "scalable": false,
      "non_scalable_qty": null
    },
    {
      "position": 8,
      "raw_text": "2 tbsp milk",
      "quantity": null,
      "unit": null,
      "ingredient_name": "milk",
      "notes": null,
      "scalable": false,
      "non_scalable_qty": null
    },
    {
      "position": 9,
      "raw_text": "a pinch of salt",
      "quantity": null,
      "unit": null,
      "ingredient_name": "salt",
      "notes": null,
      "scalable": false,
      "non_scalable_qty": "pinch"
    },
    {
      "position": 10,
      "raw_text": "100g chopped milk chocolate",
      "quantity": 100,
      "unit": "g",
      "ingredient_name": "milk chocolate",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 11,
      "raw_text": "400g icing sugar",
      "quantity": 400,
      "unit": "g",
      "ingredient_name": "icing sugar",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 12,
      "raw_text": "5 tbsp cocoa powder",
      "quantity": null,
      "unit": null,
      "ingredient_name": "cocoa powder",
      "notes": null,
      "scalable": false,
      "non_scalable_qty": null
    },
    {
      "position": 13,
      "raw_text": "25g milk chocolate",
      "quantity": 25,
      "unit": "g",
      "ingredient_name": "milk chocolate",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 14,
      "raw_text": "25g white chocolate",
      "quantity": 25,
      "unit": "g",
      "ingredient_name": "white chocolate",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 15,
      "raw_text": "50g dark chocolate",
      "quantity": 50,
      "unit": "g",
      "ingredient_name": "dark chocolate",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    }
  ],
  "steps": [
    {
      "position": 1,
      "body": "Heat oven to 190C/170C fan/gas 5. Butter the base and sides of two 20cm round sandwich tins and line the bases with baking parchment.",
      "duration_min": null
    },
    {
      "position": 2,
      "body": "In a large bowl, beat together 200g golden caster sugar, 200g softened unsalted butter, 4 large eggs, 200g self-raising flour, 2 tbsp cocoa powder, 1 tsp baking powder, ½ tsp vanilla extract, 2 tbsp milk and a pinch of salt until pale.",
      "duration_min": null
    },
    {
      "position": 3,
      "body": "Divide the mixture between the prepared tins. Bake for 20 mins or until a skewer inserted into the centre of the cake comes out clean.",
      "duration_min": 20
    },
    {
      "position": 4,
      "body": "Leave to cool in the tin for 10 mins, then turn out onto a wire rack to cool completely.",
      "duration_min": null
    },
    {
      "position": 5,
      "body": "For the buttercream, put 100g chopped milk chocolate in a heatproof bowl and melt in the microwave, stirring every 30 secs. Leave the melted chocolate to cool for 5 mins.",
      "duration_min": null
    },
    {
      "position": 6,
      "body": "Mash 200g softened butter and 400g icing sugar together with a fork, then switch to a wooden spoon or electric beaters, if you have them.",
      "duration_min": null
    },
    {
      "position": 7,
      "body": "Sift in 5 tbsp cocoa powder with a pinch of salt and pour in the melted chocolate and 2 tbsp milk. Mix again until smooth.",
      "duration_min": null
    },
    {
      "position": 8,
      "body": "On a cake stand or large plate, sandwich the cakes together with half of the buttercream, then spread the rest on top. Decorate with chocolate shards, if you like.",
      "duration_min": null
    },
    {
      "position": 9,
      "body": "To make chocolate shards: melt 50g dark chocolate and pour it onto a tray lined with baking parchment or foil.",
      "duration_min": null
    },
    {
      "position": 10,
      "body": "Now melt 25g milk chocolate and 25g white chocolate and drizzle them over the dark chocolate before it sets.",
      "duration_min": null
    },
    {
      "position": 11,
      "body": "Shake the tray gently to level the mixture then leave to set somewhere cool. Chop into shards.",
      "duration_min": null
    }
  ]
}
```

**Judge:**
- Completeness: 4
- Fidelity: 3
- Format hygiene: 2
- Overall: 3
- Notes: Captured all 15 ingredients including buttercream subset and chocolate-shard items. Schema fails on source_language='English' (must be BCP-47 'en'). Several straightforward quantities/units left null — '4 large eggs' got quantity=null instead of 4/count, '2 tbsp cocoa powder' got quantity=null instead of 2/tbsp.

#### Model: haiku-4.5
- schema_ok: true
- latency_ms: 8851
- tokens_in: 1037, tokens_out: 2388
- error: —

**Raw output:**

```json
```json
{
  "title": "Easy chocolate cake",
  "description": null,
  "source_type": "url",
  "source_url": "https://www.bbcgoodfood.com/recipes/easy-chocolate-cake",
  "source_language": "en",
  "canonical_unit_system": "metric",
  "servings": 14,
  "total_time_min": null,
  "tags": [],
  "hero_image_path": null,
  "ingredients": [
    {
      "position": 1,
      "raw_text": "200g golden caster sugar",
      "quantity": 200,
      "unit": "g",
      "ingredient_name": "golden caster sugar",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 2,
      "raw_text": "200g softened unsalted butter",
      "quantity": 200,
      "unit": "g",
      "ingredient_name": "softened unsalted butter",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 3,
      "raw_text": "4 large eggs",
      "quantity": 4,
      "unit": "count",
      "ingredient_name": "large eggs",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 4,
      "raw_text": "200g self-raising flour",
      "quantity": 200,
      "unit": "g",
      "ingredient_name": "self-raising flour",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 5,
      "raw_text": "2 tbsp cocoa powder",
      "quantity": 2,
      "unit": "tbsp",
      "ingredient_name": "cocoa powder",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 6,
      "raw_text": "1 tsp baking powder",
      "quantity": 1,
      "unit": "tsp",
      "ingredient_name": "baking powder",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 7,
      "raw_text": "½ tsp vanilla extract",
      "quantity": {
        "numerator": 1,
        "denominator": 2
      },
      "unit": "tsp",
      "ingredient_name": "vanilla extract",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 8,
      "raw_text": "2 tbsp milk",
      "quantity": 2,
      "unit": "tbsp",
      "ingredient_name": "milk",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 9,
      "raw_text": "a pinch of salt",
      "quantity": null,
      "unit": null,
      "ingredient_name": "salt",
      "notes": null,
      "scalable": false,
      "non_scalable_qty": "pinch"
    },
    {
      "position": 10,
      "raw_text": "100g chopped milk chocolate",
      "quantity": 100,
      "unit": "g",
      "ingredient_name": "chopped milk chocolate",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 11,
      "raw_text": "200g softened butter",
      "quantity": 200,
      "unit": "g",
      "ingredient_name": "softened butter",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 12,
      "raw_text": "400g icing sugar",
      "quantity": 400,
      "unit": "g",
      "ingredient_name": "icing sugar",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 13,
      "raw_text": "5 tbsp cocoa powder",
      "quantity": 5,
      "unit": "tbsp",
      "ingredient_name": "cocoa powder",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 14,
      "raw_text": "a pinch of salt",
      "quantity": null,
      "unit": null,
      "ingredient_name": "salt",
      "notes": null,
      "scalable": false,
      "non_scalable_qty": "pinch"
    },
    {
      "position": 15,
      "raw_text": "2 tbsp milk",
      "quantity": 2,
      "unit": "tbsp",
      "ingredient_name": "milk",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 16,
      "raw_text": "50g dark chocolate",
      "quantity": 50,
      "unit": "g",
      "ingredient_name": "dark chocolate",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 17,
      "raw_text": "25g milk chocolate",
      "quantity": 25,
      "unit": "g",
      "ingredient_name": "milk chocolate",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 18,
      "raw_text": "25g white chocolate",
      "quantity": 25,
      "unit": "g",
      "ingredient_name": "white chocolate",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    }
  ],
  "steps": [
    {
      "position": 1,
      "body": "Heat oven to 190C/170C fan/gas 5. Butter the base and sides of two 20cm round sandwich tins and line the bases with baking parchment.",
      "duration_min": null
    },
    {
      "position": 2,
      "body": "In a large bowl, beat together 200g golden caster sugar, 200g softened unsalted butter, 4 large eggs, 200g self-raising flour, 2 tbsp cocoa powder, 1 tsp baking powder, ½ tsp vanilla extract, 2 tbsp milk and a pinch of salt until pale.",
      "duration_min": null
    },
    {
      "position": 3,
      "body": "Divide the mixture between the prepared tins. Bake for 20 mins or until a skewer inserted into the centre of the cake comes out clean.",
      "duration_min": 20
    },
    {
      "position": 4,
      "body": "Leave to cool in the tin for 10 mins, then turn out onto a wire rack to cool completely.",
      "duration_min": 10
    },
    {
      "position": 5,
      "body": "For the buttercream, put 100g chopped milk chocolate in a heatproof bowl and melt in the microwave, stirring every 30 secs. Leave the melted chocolate to cool for 5 mins.",
      "duration_min": 5
    },
    {
      "position": 6,
      "body": "Mash 200g softened butter and 400g icing sugar together with a fork, then switch to a wooden spoon or electric beaters, if you have them.",
      "duration_min": null
    },
    {
      "position": 7,
      "body": "Sift in 5 tbsp cocoa powder with a pinch of salt and pour in the melted chocolate and 2 tbsp milk. Mix again until smooth.",
      "duration_min": null
    },
    {
      "position": 8,
      "body": "On a cake stand or large plate, sandwich the cakes together with half of the buttercream, then spread the rest on top. Decorate with chocolate shards, if you like.",
      "duration_min": null
    },
    {
      "position": 9,
      "body": "To make chocolate shards: melt 50g dark chocolate and pour it onto a tray lined with baking parchment or foil.",
      "duration_min": null
    },
    {
      "position": 10,
      "body": "Now melt 25g milk chocolate and 25g white chocolate and drizzle them over the dark chocolate before it sets.",
      "duration_min": null
    },
    {
      "position": 11,
      "body": "Shake the tray gently to level the mixture then leave to set somewhere cool. Chop into shards.",
      "duration_min": null
    }
  ]
}
```
```

**Judge:**
- Completeness: 5
- Fidelity: 4
- Format hygiene: 4
- Overall: 4
- Notes: All 18 ingredients captured (including buttercream and shards). Proper fraction handling for ½ tsp via numerator/denominator. Units canonical (g, tsp, tbsp, count). Source language correctly 'en'. Output wrapped in extra ```json fences but parsed OK after fence-strip. One duplication: '200g softened butter' appears twice (cake batter and buttercream both use butter, model conflated).

#### Model: sonnet-4.6
- schema_ok: true
- latency_ms: 16888
- tokens_in: 1038, tokens_out: 2448
- error: —

**Raw output:**

```json
{
  "title": "Easy chocolate cake",
  "description": null,
  "source_type": "url",
  "source_url": "https://www.bbcgoodfood.com/recipes/easy-chocolate-cake",
  "source_language": "en",
  "canonical_unit_system": "metric",
  "servings": 14,
  "total_time_min": null,
  "tags": ["chocolate", "cake", "baking", "dessert"],
  "hero_image_path": null,
  "ingredients": [
    {
      "position": 1,
      "raw_text": "200g golden caster sugar",
      "quantity": 200,
      "unit": "g",
      "ingredient_name": "golden caster sugar",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 2,
      "raw_text": "200g softened unsalted butter",
      "quantity": 200,
      "unit": "g",
      "ingredient_name": "unsalted butter",
      "notes": "softened",
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 3,
      "raw_text": "4 large eggs",
      "quantity": 4,
      "unit": "count",
      "ingredient_name": "large eggs",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 4,
      "raw_text": "200g self-raising flour",
      "quantity": 200,
      "unit": "g",
      "ingredient_name": "self-raising flour",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 5,
      "raw_text": "2 tbsp cocoa powder",
      "quantity": 2,
      "unit": "tbsp",
      "ingredient_name": "cocoa powder",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 6,
      "raw_text": "1 tsp baking powder",
      "quantity": 1,
      "unit": "tsp",
      "ingredient_name": "baking powder",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 7,
      "raw_text": "½ tsp vanilla extract",
      "quantity": { "numerator": 1, "denominator": 2 },
      "unit": "tsp",
      "ingredient_name": "vanilla extract",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 8,
      "raw_text": "2 tbsp milk",
      "quantity": 2,
      "unit": "tbsp",
      "ingredient_name": "milk",
      "notes": "for the cake batter",
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 9,
      "raw_text": "a pinch of salt",
      "quantity": null,
      "unit": null,
      "ingredient_name": "salt",
      "notes": "for the cake batter",
      "scalable": false,
      "non_scalable_qty": "pinch"
    },
    {
      "position": 10,
      "raw_text": "100g chopped milk chocolate",
      "quantity": 100,
      "unit": "g",
      "ingredient_name": "milk chocolate",
      "notes": "chopped, for the buttercream",
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 11,
      "raw_text": "200g softened butter",
      "quantity": 200,
      "unit": "g",
      "ingredient_name": "butter",
      "notes": "softened, for the buttercream",
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 12,
      "raw_text": "400g icing sugar",
      "quantity": 400,
      "unit": "g",
      "ingredient_name": "icing sugar",
      "notes": "for the buttercream",
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 13,
      "raw_text": "5 tbsp cocoa powder",
      "quantity": 5,
      "unit": "tbsp",
      "ingredient_name": "cocoa powder",
      "notes": "for the buttercream",
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 14,
      "raw_text": "a pinch of salt",
      "quantity": null,
      "unit": null,
      "ingredient_name": "salt",
      "notes": "for the buttercream",
      "scalable": false,
      "non_scalable_qty": "pinch"
    },
    {
      "position": 15,
      "raw_text": "2 tbsp milk",
      "quantity": 2,
      "unit": "tbsp",
      "ingredient_name": "milk",
      "notes": "for the buttercream",
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 16,
      "raw_text": "50g dark chocolate",
      "quantity": 50,
      "unit": "g",
      "ingredient_name": "dark chocolate",
      "notes": "for the chocolate shards",
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 17,
      "raw_text": "25g milk chocolate",
      "quantity": 25,
      "unit": "g",
      "ingredient_name": "milk chocolate",
      "notes": "for the chocolate shards",
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 18,
      "raw_text": "25g white chocolate",
      "quantity": 25,
      "unit": "g",
      "ingredient_name": "white chocolate",
      "notes": "for the chocolate shards",
      "scalable": true,
      "non_scalable_qty": null
    }
  ],
  "steps": [
    {
      "position": 1,
      "body": "Heat oven to 190C/170C fan/gas 5. Butter the base and sides of two 20cm round sandwich tins and line the bases with baking parchment.",
      "duration_min": null
    },
    {
      "position": 2,
      "body": "In a large bowl, beat together 200g golden caster sugar, 200g softened unsalted butter, 4 large eggs, 200g self-raising flour, 2 tbsp cocoa powder, 1 tsp baking powder, ½ tsp vanilla extract, 2 tbsp milk and a pinch of salt until pale.",
      "duration_min": null
    },
    {
      "position": 3,
      "body": "Divide the mixture between the prepared tins. Bake for 20 mins or until a skewer inserted into the centre of the cake comes out clean.",
      "duration_min": 20
    },
    {
      "position": 4,
      "body": "Leave to cool in the tin for 10 mins, then turn out onto a wire rack to cool completely.",
      "duration_min": 10
    },
    {
      "position": 5,
      "body": "For the buttercream, put 100g chopped milk chocolate in a heatproof bowl and melt in the microwave, stirring every 30 secs. Leave the melted chocolate to cool for 5 mins.",
      "duration_min": 5
    },
    {
      "position": 6,
      "body": "Mash 200g softened butter and 400g icing sugar together with a fork, then switch to a wooden spoon or electric beaters, if you have them.",
      "duration_min": null
    },
    {
      "position": 7,
      "body": "Sift in 5 tbsp cocoa powder with a pinch of salt and pour in the melted chocolate and 2 tbsp milk. Mix again until smooth.",
      "duration_min": null
    },
    {
      "position": 8,
      "body": "On a cake stand or large plate, sandwich the cakes together with half of the buttercream, then spread the rest on top. Decorate with chocolate shards, if you like.",
      "duration_min": null
    },
    {
      "position": 9,
      "body": "To make chocolate shards: melt 50g dark chocolate and pour it onto a tray lined with baking parchment or foil.",
      "duration_min": null
    },
    {
      "position": 10,
      "body": "Now melt 25g milk chocolate and 25g white chocolate and drizzle them over the dark chocolate before it sets.",
      "duration_min": null
    },
    {
      "position": 11,
      "body": "Shake the tray gently to level the mixture then leave to set somewhere cool. Chop into shards.",
      "duration_min": null
    }
  ]
}
```

**Judge:**
- Completeness: 5
- Fidelity: 5
- Format hygiene: 5
- Overall: 5
- Notes: Excellent capture of all 18 ingredients with section context preserved in notes ('for the buttercream', 'for the chocolate shards'). Tags populated. All units canonical, fractions correct, language correct. Reference-quality output.

### URL 2 — https://www.bonappetit.com/recipe/bas-best-chocolate-chip-cookies

**Source excerpt** (first 2000 chars of cleaned text):

```
Food director Chris Morocco spent months developing this chocolate chip cookie recipe—testing 30 batches, then cross-testing 10 more—to land on what he considers the icon’s Platonic ideal: intentionally thin cookies with deeply caramelized flavor, crisp edges, and a soft, chewy center. Rooted in classic Toll House DNA, the recipe is elevated with brown butter for nutty depth and a higher proportion of brown sugar for richness and chew.Because the dough also has a high butter-to-flour ratio, small variables—like kitchen temperature, flour brand, or how warm the dough is when it goes into the oven—can affect how much the cookies spread. When those factors are in balance, the payoff is chocolate chip cookies with rippled edges, puddles of melted chocolate, and a texture that sets as it cools.Tips for the best chocolate chip cookiesExpect spread: This recipe is designed to bake up thin, with crisp, rippled edges. For slightly thicker cookies with less spread, chill the dough overnight or portion it into balls and freeze (dough balls can be baked straight from the freezer). Using a higher-protein all-purpose flour, such as King Arthur, can also help limit spreading. Avoid silicone baking mats here as they encourage spreading.Measure flour precisely: We strongly recommend weighing your flour and sugar. If using volume measures, spoon ingredients into your measuring cup, then level with a flat-edged utensil. Undermeasuring flour can lead to greasy cookies, while overmeasuring sugar can make them flat.Watch the bake, not the clock: Timing is a guideline and may vary based on oven calibration and kitchen conditions, so trust the visual cues above all else. Pull the cookies when the edges are deep golden, and the centers look just underdone; they’ll firm up as they cool.Brown the butter thoroughly: Browning butter adds a rich, toffee-like flavor and reduces its water content (important for the cookie’s texture). Use a light-colored pan and cook until the milk solids turn deep
```

#### Model: nemotron-70b
- schema_ok: false
- latency_ms: 0
- tokens_in: 0, tokens_out: 0
- error: http_404

**Raw output:**

```json
{"status":404,"title":"Not Found","detail":"Function '9b96341b-9791-4db9-a00d-4e43aa192a39': Not found for account 'Bdj1-MwCjvJSM-nUQGOuBcY0g5zIjBPxNfv8IJMf5Gc'"}
```

**Judge:**
- Completeness: 1
- Fidelity: 1
- Format hygiene: 1
- Overall: 1
- Notes: http_404 (model id not accessible). No output.

#### Model: llama-3.3-70b
- schema_ok: false
- latency_ms: 31039
- tokens_in: 1017, tokens_out: 538
- error: schema: source_language

**Raw output:**

```json
{
  "title": "BA's Best Chocolate Chip Cookies",
  "description": "Intentionally thin cookies with deeply caramelized flavor, crisp edges, and a soft, chewy center.",
  "source_type": "url",
  "source_url": "https://www.bonappetit.com/recipe/bas-best-chocolate-chip-cookies",
  "source_language": "English",
  "canonical_unit_system": "imperial",
  "servings": null,
  "total_time_min": null,
  "tags": [
    "chocolate chip cookies",
    "cookies",
    "dessert"
  ],
  "hero_image_path": null,
  "ingredients": [
    {
      "position": 1,
      "raw_text": "brown butter",
      "quantity": null,
      "unit": null,
      "ingredient_name": "butter",
      "notes": "brown thoroughly",
      "scalable": false,
      "non_scalable_qty": null
    },
    {
      "position": 2,
      "raw_text": "all-purpose flour",
      "quantity": null,
      "unit": null,
      "ingredient_name": "flour",
      "notes": "high-protein recommended",
      "scalable": false,
      "non_scalable_qty": null
    },
    {
      "position": 3,
      "raw_text": "brown sugar",
      "quantity": null,
      "unit": null,
      "ingredient_name": "brown sugar",
      "notes": null,
      "scalable": false,
      "non_scalable_qty": null
    },
    {
      "position": 4,
      "raw_text": "chocolate chips",
      "quantity": null,
      "unit": null,
      "ingredient_name": "chocolate chips",
      "notes": null,
      "scalable": false,
      "non_scalable_qty": null
    }
  ],
  "steps": [
    {
      "position": 1,
      "body": "Brown the butter thoroughly in a light-colored pan until the milk solids turn deep golden brown.",
      "duration_min": null
    },
    {
      "position": 2,
      "body": "Mix the dough and chill it briefly if necessary to mitigate spreading.",
      "duration_min": null
    },
    {
      "position": 3,
      "body": "Scoop the dough into balls and bake until the edges are deep golden and the centers look just underdone.",
      "duration_min": null
    }
  ]
}
```

**Judge:**
- Completeness: 2
- Fidelity: 2
- Format hygiene: 1
- Overall: 2
- Notes: Produced sparse output: only 4 placeholder ingredients ('brown butter', 'all-purpose flour', 'brown sugar', 'chocolate chips') with no quantities, and 3 generic steps. Schema fail on source_language='English'. Source excerpt didn't include the explicit ingredient list, but the model didn't even capture the qualitative descriptions.

#### Model: qwen2.5-72b
- schema_ok: false
- latency_ms: 0
- tokens_in: 0, tokens_out: 0
- error: http_404

**Raw output:**

```json
404 page not found

```

**Judge:**
- Completeness: 1
- Fidelity: 1
- Format hygiene: 1
- Overall: 1
- Notes: http_404 (model not accessible). No output.

#### Model: mixtral-8x22b
- schema_ok: false
- latency_ms: 0
- tokens_in: 0, tokens_out: 0
- error: http_500

**Raw output:**

```json
{"error":{"message":"EngineCore encountered an issue. See stack trace (above) for the root cause.","type":"Internal Server Error","param":null,"code":500}}
```

**Judge:**
- Completeness: 1
- Fidelity: 1
- Format hygiene: 1
- Overall: 1
- Notes: NIM http_500. No output.

#### Model: llama-3.1-8b
- schema_ok: false
- latency_ms: 8236
- tokens_in: 1049, tokens_out: 1163
- error: schema: source_language

**Raw output:**

```json
{
  "title": "Bas Best Chocolate Chip Cookies",
  "description": null,
  "source_type": "url",
  "source_url": "https://www.bonappetit.com/recipe/bas-best-chocolate-chip-cookies",
  "source_language": "English",
  "canonical_unit_system": "metric",
  "servings": null,
  "total_time_min": null,
  "tags": [
    "chocolate chip cookies",
    "brown butter",
    "caramelized flavor",
    "crisp edges",
    "soft chewy center"
  ],
  "hero_image_path": null,
  "ingredients": [
    {
      "position": 1,
      "raw_text": "2 1/4 cups all-purpose flour",
      "quantity": 2.25,
      "unit": "cup_us",
      "ingredient_name": "all-purpose flour",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 2,
      "raw_text": "1 tsp baking soda",
      "quantity": 1,
      "unit": "tsp",
      "ingredient_name": "baking soda",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 3,
      "raw_text": "1 tsp salt",
      "quantity": 1,
      "unit": "tsp",
      "ingredient_name": "salt",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 4,
      "raw_text": "1 cup unsalted butter, browned",
      "quantity": null,
      "unit": null,
      "ingredient_name": "unsalted butter",
      "notes": "browned",
      "scalable": false,
      "non_scalable_qty": "to_taste"
    },
    {
      "position": 5,
      "raw_text": "3/4 cup white granulated sugar",
      "quantity": 0.75,
      "unit": "cup_us",
      "ingredient_name": "white granulated sugar",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 6,
      "raw_text": "3/4 cup packed light brown sugar",
      "quantity": 0.75,
      "unit": "cup_us",
      "ingredient_name": "packed light brown sugar",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 7,
      "raw_text": "2 large eggs",
      "quantity": 2,
      "unit": "count",
      "ingredient_name": "large eggs",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 8,
      "raw_text": "2 tsp pure vanilla extract",
      "quantity": 2,
      "unit": "tsp",
      "ingredient_name": "pure vanilla extract",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 9,
      "raw_text": "2 cups semi-sweet chocolate chips",
      "quantity": 2,
      "unit": "count",
      "ingredient_name": "semi-sweet chocolate chips",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    }
  ],
  "steps": [
    {
      "position": 1,
      "body": "Preheat oven to 375°F (190°C). Line a baking sheet with parchment paper.",
      "duration_min": null
    },
    {
      "position": 2,
      "body": "Whisk together flour, baking soda, and salt in a medium bowl.",
      "duration_min": null
    },
    {
      "position": 3,
      "body": "In a large bowl, use an electric mixer to beat browned butter until it's light and fluffy, about 2 minutes.",
      "duration_min": null
    },
    {
      "position": 4,
      "body": "Gradually add sugars and beat until light and fluffy, about 2 minutes.",
      "duration_min": null
    },
    {
      "position": 5,
      "body": "Beat in eggs one at a time, followed by vanilla extract.",
      "duration_min": null
    },
    {
      "position": 6,
      "body": "With mixer on low speed, gradually add flour mixture and mix until just combined, about 1 minute.",
      "duration_min": null
    },
    {
      "position": 7,
      "body": "Stir in chocolate chips.",
      "duration_min": null
    },
    {
      "position": 8,
      "body": "Scoop tablespoon-sized balls of dough onto prepared baking sheet, leaving about 2 inches of space between each cookie.",
      "duration_min": null
    },
    {
      "position": 9,
      "body": "Bake until edges are deep golden brown and centers are just underdone, about 10-12 minutes.",
      "duration_min": null
    }
  ]
}
```

**Judge:**
- Completeness: 3
- Fidelity: 2
- Format hygiene: 2
- Overall: 2
- Notes: Hallucinated a full Toll-House-style ingredient list (2 1/4 cups flour, 1 tsp baking soda, browned butter, etc.) that is NOT present in the source excerpt — these are reasonable defaults but invented. Schema fail on source_language='English'. 'count' as unit for chocolate chips is wrong ('2 cups' got quantity=2 unit='count'). Hallucination concern.

#### Model: haiku-4.5
- schema_ok: false
- latency_ms: 2185
- tokens_in: 1177, tokens_out: 275
- error: schema: servings

**Raw output:**

```json
```json
{
  "title": "Bas's Best Chocolate Chip Cookies",
  "description": "Food director Chris Morocco spent months developing this chocolate chip cookie recipe—testing 30 batches, then cross-testing 10 more—to land on what he considers the icon's Platonic ideal: intentionally thin cookies with deeply caramelized flavor, crisp edges, and a soft, chewy center. Rooted in classic Toll House DNA, the recipe is elevated with brown butter for nutty depth and a higher proportion of brown sugar for richness and chew.",
  "source_type": "url",
  "source_url": "https://www.bonappetit.com/recipe/bas-best-chocolate-chip-cookies",
  "source_language": "en",
  "canonical_unit_system": "imperial",
  "servings": null,
  "total_time_min": null,
  "tags": [
    "chocolate chip cookies",
    "brown butter",
    "dessert",
    "baking"
  ],
  "hero_image_path": null,
  "ingredients": [],
  "steps": []
}
```
```

**Judge:**
- Completeness: 2
- Fidelity: 4
- Format hygiene: 3
- Overall: 2
- Notes: Returned empty ingredients[] and steps[]. Honest about not having the data, but also missed three step descriptions visible in the source ('Brown the butter', etc.). Schema fail on servings=null (Recipe.servings requires int 1-200). Description copied verbatim from source.

#### Model: sonnet-4.6
- schema_ok: true
- latency_ms: 4854
- tokens_in: 1178, tokens_out: 471
- error: —

**Raw output:**

```json
{
  "title": "BA's Best Chocolate Chip Cookies",
  "description": "Food director Chris Morocco spent months developing this chocolate chip cookie recipe—testing 30 batches, then cross-testing 10 more—to land on what he considers the icon's Platonic ideal: intentionally thin cookies with deeply caramelized flavor, crisp edges, and a soft, chewy center. Rooted in classic Toll House DNA, the recipe is elevated with brown butter for nutty depth and a higher proportion of brown sugar for richness and chew.",
  "source_type": "url",
  "source_url": "https://www.bonappetit.com/recipe/bas-best-chocolate-chip-cookies",
  "source_language": "en",
  "canonical_unit_system": "imperial",
  "servings": 24,
  "total_time_min": null,
  "tags": ["cookies", "chocolate chip", "brown butter", "dessert", "baking"],
  "hero_image_path": null,
  "ingredients": [],
  "steps": [
    {
      "position": 1,
      "body": "Brown the butter thoroughly using a light-colored pan, cooking until the milk solids turn deep golden brown. Have the remaining butter at the ready, but still cold, to stop the cooking and protect those toasty bits from turning black and bitter.",
      "duration_min": null
    },
    {
      "position": 2,
      "body": "Mix the dough. If your kitchen runs warm or the dough feels loose after mixing—especially if the brown butter was still warm—chill the dough briefly before baking.",
      "duration_min": null
    },
    {
      "position": 3,
      "body": "Portion the dough and bake. Pull the cookies when the edges are deep golden and the centers look just underdone; they'll firm up as they cool.",
      "duration_min": null
    }
  ]
}
```

**Judge:**
- Completeness: 3
- Fidelity: 4
- Format hygiene: 5
- Overall: 3
- Notes: Honest about missing ingredient list (returned empty []). Captured 3 high-level steps from the article body (browning, mixing, portioning). Inferred servings=24 (reasonable Toll-House yield). Tags populated. Format correct throughout. The 'no hallucination, no false ingredient list' approach is the right call when the source is a tip-style article.

### URL 3 — https://www.foodnetwork.com/recipes/ina-garten/perfect-roast-chicken-recipe-1940592

**Source excerpt** (first 2000 chars of cleaned text):

```
1) Preheat the oven to 210°c/Gas mark 7. Remove the chicken giblets. Rinse the chicken inside and out. Remove any excess fat and leftover pin feathers and pat the outside dry. 
2) Liberally salt and pepper the inside of the chicken. Stuff the cavity with the bunch of thyme, both halves of lemon, and all the garlic. Brush the outside of the chicken with the butter and sprinkle again with salt and pepper. 
3) Tie the legs together with kitchen string and tuck the wing tips under the body of the chicken. Place the onions, carrots, and fennel in a roasting pan. Toss with salt, pepper, 20 sprigs of thyme, and olive oil. Spread around the bottom of the roasting pan and place the chicken on top. 
4) Roast the chicken for 1 1/2 hours, or until the juices run clear when you cut between a leg and thigh. Remove the chicken and vegetables to a platter and cover with aluminium foil for about 20 minutes. Slice the chicken onto a platter and serve it with the vegetables.
```

#### Model: nemotron-70b
- schema_ok: false
- latency_ms: 0
- tokens_in: 0, tokens_out: 0
- error: http_404

**Raw output:**

```json
{"status":404,"title":"Not Found","detail":"Function '9b96341b-9791-4db9-a00d-4e43aa192a39': Not found for account 'Bdj1-MwCjvJSM-nUQGOuBcY0g5zIjBPxNfv8IJMf5Gc'"}
```

**Judge:**
- Completeness: 1
- Fidelity: 1
- Format hygiene: 1
- Overall: 1
- Notes: http_404. No output.

#### Model: llama-3.3-70b
- schema_ok: false
- latency_ms: 90000
- tokens_in: 0, tokens_out: 0
- error: timeout

**Raw output:**

```json

```

**Judge:**
- Completeness: 1
- Fidelity: 1
- Format hygiene: 1
- Overall: 1
- Notes: Timed out at 90s; no output.

#### Model: qwen2.5-72b
- schema_ok: false
- latency_ms: 0
- tokens_in: 0, tokens_out: 0
- error: http_404

**Raw output:**

```json
404 page not found

```

**Judge:**
- Completeness: 1
- Fidelity: 1
- Format hygiene: 1
- Overall: 1
- Notes: http_404. No output.

#### Model: mixtral-8x22b
- schema_ok: false
- latency_ms: 0
- tokens_in: 0, tokens_out: 0
- error: http_500

**Raw output:**

```json
{"error":{"message":"EngineCore encountered an issue. See stack trace (above) for the root cause.","type":"Internal Server Error","param":null,"code":500}}
```

**Judge:**
- Completeness: 1
- Fidelity: 1
- Format hygiene: 1
- Overall: 1
- Notes: NIM http_500. No output.

#### Model: llama-3.1-8b
- schema_ok: true
- latency_ms: 10606
- tokens_in: 695, tokens_out: 1141
- error: —

**Raw output:**

```json
{
  "title": "Perfect Roast Chicken Recipe",
  "description": null,
  "source_type": "url",
  "source_url": "https://www.foodnetwork.com/recipes/ina-garten/perfect-roast-chicken-recipe-1940592",
  "source_language": "en",
  "canonical_unit_system": "metric",
  "servings": 1,
  "total_time_min": null,
  "tags": [],
  "hero_image_path": null,
  "ingredients": [
    {
      "position": 1,
      "raw_text": "chicken giblets",
      "quantity": null,
      "unit": null,
      "ingredient_name": "chicken",
      "notes": null,
      "scalable": false,
      "non_scalable_qty": null
    },
    {
      "position": 2,
      "raw_text": "bunch of thyme",
      "quantity": null,
      "unit": null,
      "ingredient_name": "thyme",
      "notes": null,
      "scalable": false,
      "non_scalable_qty": null
    },
    {
      "position": 3,
      "raw_text": "both halves of lemon",
      "quantity": null,
      "unit": null,
      "ingredient_name": "lemon",
      "notes": null,
      "scalable": false,
      "non_scalable_qty": null
    },
    {
      "position": 4,
      "raw_text": "all the garlic",
      "quantity": null,
      "unit": null,
      "ingredient_name": "garlic",
      "notes": null,
      "scalable": false,
      "non_scalable_qty": null
    },
    {
      "position": 5,
      "raw_text": "butter",
      "quantity": null,
      "unit": null,
      "ingredient_name": "butter",
      "notes": null,
      "scalable": false,
      "non_scalable_qty": null
    },
    {
      "position": 6,
      "raw_text": "onions",
      "quantity": null,
      "unit": null,
      "ingredient_name": "onions",
      "notes": null,
      "scalable": false,
      "non_scalable_qty": null
    },
    {
      "position": 7,
      "raw_text": "carrots",
      "quantity": null,
      "unit": null,
      "ingredient_name": "carrots",
      "notes": null,
      "scalable": false,
      "non_scalable_qty": null
    },
    {
      "position": 8,
      "raw_text": "fennel",
      "quantity": null,
      "unit": null,
      "ingredient_name": "fennel",
      "notes": null,
      "scalable": false,
      "non_scalable_qty": null
    },
    {
      "position": 9,
      "raw_text": "salt",
      "quantity": null,
      "unit": null,
      "ingredient_name": "salt",
      "notes": null,
      "scalable": false,
      "non_scalable_qty": null
    },
    {
      "position": 10,
      "raw_text": "pepper",
      "quantity": null,
      "unit": null,
      "ingredient_name": "pepper",
      "notes": null,
      "scalable": false,
      "non_scalable_qty": null
    },
    {
      "position": 11,
      "raw_text": "olive oil",
      "quantity": null,
      "unit": null,
      "ingredient_name": "olive oil",
      "notes": null,
      "scalable": false,
      "non_scalable_qty": null
    }
  ],
  "steps": [
    {
      "position": 1,
      "body": "Preheat the oven to 210°c/Gas mark 7. Remove the chicken giblets. Rinse the chicken inside and out. Remove any excess fat and leftover pin feathers and pat the outside dry.",
      "duration_min": null
    },
    {
      "position": 2,
      "body": "Liberally salt and pepper the inside of the chicken. Stuff the cavity with the bunch of thyme, both halves of lemon, and all the garlic. Brush the outside of the chicken with the butter and sprinkle again with salt and pepper.",
      "duration_min": null
    },
    {
      "position": 3,
      "body": "Tie the legs together with kitchen string and tuck the wing tips under the body of the chicken. Place the onions, carrots, and fennel in a roasting pan. Toss with salt, pepper, 20 sprigs of thyme, and olive oil. Spread around the bottom of the roasting pan and place the chicken on top.",
      "duration_min": null
    },
    {
      "position": 4,
      "body": "Roast the chicken for 1 1/2 hours, or until the juices run clear when you cut between a leg and thigh. Remove the chicken and vegetables to a platter and cover with aluminium foil for about 20 minutes. Slice the chicken onto a platter and serve it with the vegetables.",
      "duration_min": 90
    }
  ]
}
```

**Judge:**
- Completeness: 4
- Fidelity: 4
- Format hygiene: 4
- Overall: 4
- Notes: Captured 11 ingredients faithfully (all without quantities — matches source which has none). Steps copied accurately. servings=1 is low but defensible. Source language correct. Solid for a sparse-source recipe.

#### Model: haiku-4.5
- schema_ok: true
- latency_ms: 5832
- tokens_in: 777, tokens_out: 1487
- error: —

**Raw output:**

```json
```json
{
  "title": "Perfect Roast Chicken",
  "description": null,
  "source_type": "url",
  "source_url": "https://www.foodnetwork.com/recipes/ina-garten/perfect-roast-chicken-recipe-1940592",
  "source_language": "en",
  "canonical_unit_system": "metric",
  "servings": 1,
  "total_time_min": 110,
  "tags": [],
  "hero_image_path": null,
  "ingredients": [
    {
      "position": 1,
      "raw_text": "1 chicken",
      "quantity": 1,
      "unit": "count",
      "ingredient_name": "chicken",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 2,
      "raw_text": "salt",
      "quantity": null,
      "unit": null,
      "ingredient_name": "salt",
      "notes": null,
      "scalable": false,
      "non_scalable_qty": "to_taste"
    },
    {
      "position": 3,
      "raw_text": "pepper",
      "quantity": null,
      "unit": null,
      "ingredient_name": "pepper",
      "notes": null,
      "scalable": false,
      "non_scalable_qty": "to_taste"
    },
    {
      "position": 4,
      "raw_text": "bunch of thyme",
      "quantity": 1,
      "unit": "count",
      "ingredient_name": "thyme",
      "notes": "bunch",
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 5,
      "raw_text": "2 halves of lemon",
      "quantity": 2,
      "unit": "count",
      "ingredient_name": "lemon",
      "notes": "halves",
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 6,
      "raw_text": "all the garlic",
      "quantity": null,
      "unit": null,
      "ingredient_name": "garlic",
      "notes": null,
      "scalable": false,
      "non_scalable_qty": "to_taste"
    },
    {
      "position": 7,
      "raw_text": "butter",
      "quantity": null,
      "unit": null,
      "ingredient_name": "butter",
      "notes": null,
      "scalable": false,
      "non_scalable_qty": "to_taste"
    },
    {
      "position": 8,
      "raw_text": "onions",
      "quantity": null,
      "unit": null,
      "ingredient_name": "onions",
      "notes": null,
      "scalable": false,
      "non_scalable_qty": "to_taste"
    },
    {
      "position": 9,
      "raw_text": "carrots",
      "quantity": null,
      "unit": null,
      "ingredient_name": "carrots",
      "notes": null,
      "scalable": false,
      "non_scalable_qty": "to_taste"
    },
    {
      "position": 10,
      "raw_text": "fennel",
      "quantity": null,
      "unit": null,
      "ingredient_name": "fennel",
      "notes": null,
      "scalable": false,
      "non_scalable_qty": "to_taste"
    },
    {
      "position": 11,
      "raw_text": "20 sprigs of thyme",
      "quantity": 20,
      "unit": "count",
      "ingredient_name": "thyme",
      "notes": "sprigs",
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 12,
      "raw_text": "olive oil",
      "quantity": null,
      "unit": null,
      "ingredient_name": "olive oil",
      "notes": null,
      "scalable": false,
      "non_scalable_qty": "to_taste"
    }
  ],
  "steps": [
    {
      "position": 1,
      "body": "Preheat the oven to 210°C/Gas mark 7. Remove the chicken giblets. Rinse the chicken inside and out. Remove any excess fat and leftover pin feathers and pat the outside dry.",
      "duration_min": null
    },
    {
      "position": 2,
      "body": "Liberally salt and pepper the inside of the chicken. Stuff the cavity with the bunch of thyme, both halves of lemon, and all the garlic. Brush the outside of the chicken with the butter and sprinkle again with salt and pepper.",
      "duration_min": null
    },
    {
      "position": 3,
      "body": "Tie the legs together with kitchen string and tuck the wing tips under the body of the chicken. Place the onions, carrots, and fennel in a roasting pan. Toss with salt, pepper, 20 sprigs of thyme, and olive oil. Spread around the bottom of the roasting pan and place the chicken on top.",
      "duration_min": null
    },
    {
      "position": 4,
      "body": "Roast the chicken for 1 1/2 hours, or until the juices run clear when you cut between a leg and thigh. Remove the chicken and vegetables to a platter and cover with aluminium foil for about 20 minutes. Slice the chicken onto a platter and serve it with the vegetables.",
      "duration_min": 90
    }
  ]
}
```
```

**Judge:**
- Completeness: 5
- Fidelity: 5
- Format hygiene: 5
- Overall: 5
- Notes: 12 ingredients with proper handling: '20 sprigs of thyme' as quantity=20/count, 'salt'/'pepper' as non_scalable_qty='to_taste', 'bunch of thyme' as quantity=1/count + notes='bunch'. total_time_min=110 reasonable. Steps preserve original method text. Excellent inference where source is implicit.

#### Model: sonnet-4.6
- schema_ok: true
- latency_ms: 13708
- tokens_in: 778, tokens_out: 1433
- error: —

**Raw output:**

```json
{
  "title": "Perfect Roast Chicken",
  "description": null,
  "source_type": "url",
  "source_url": "https://www.foodnetwork.com/recipes/ina-garten/perfect-roast-chicken-recipe-1940592",
  "source_language": "en",
  "canonical_unit_system": "metric",
  "servings": 4,
  "total_time_min": 110,
  "tags": ["chicken", "roast", "dinner", "main course"],
  "hero_image_path": null,
  "ingredients": [
    {
      "position": 1,
      "raw_text": "1 whole chicken",
      "quantity": 1,
      "unit": "count",
      "ingredient_name": "whole chicken",
      "notes": "giblets removed",
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 2,
      "raw_text": "salt",
      "quantity": null,
      "unit": null,
      "ingredient_name": "salt",
      "notes": null,
      "scalable": false,
      "non_scalable_qty": "to_taste"
    },
    {
      "position": 3,
      "raw_text": "pepper",
      "quantity": null,
      "unit": null,
      "ingredient_name": "black pepper",
      "notes": null,
      "scalable": false,
      "non_scalable_qty": "to_taste"
    },
    {
      "position": 4,
      "raw_text": "1 bunch of thyme",
      "quantity": 1,
      "unit": "count",
      "ingredient_name": "fresh thyme",
      "notes": "plus 20 sprigs for vegetables",
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 5,
      "raw_text": "1 lemon, halved",
      "quantity": 1,
      "unit": "count",
      "ingredient_name": "lemon",
      "notes": "cut in half",
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 6,
      "raw_text": "all the garlic",
      "quantity": 1,
      "unit": "count",
      "ingredient_name": "garlic",
      "notes": "whole head",
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 7,
      "raw_text": "butter",
      "quantity": null,
      "unit": null,
      "ingredient_name": "butter",
      "notes": "for brushing outside of chicken",
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 8,
      "raw_text": "onions",
      "quantity": null,
      "unit": null,
      "ingredient_name": "onions",
      "notes": "for roasting pan",
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 9,
      "raw_text": "carrots",
      "quantity": null,
      "unit": null,
      "ingredient_name": "carrots",
      "notes": "for roasting pan",
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 10,
      "raw_text": "fennel",
      "quantity": null,
      "unit": null,
      "ingredient_name": "fennel",
      "notes": "for roasting pan",
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 11,
      "raw_text": "olive oil",
      "quantity": null,
      "unit": null,
      "ingredient_name": "olive oil",
      "notes": "for tossing vegetables",
      "scalable": true,
      "non_scalable_qty": null
    }
  ],
  "steps": [
    {
      "position": 1,
      "body": "Preheat the oven to 210°c/Gas mark 7. Remove the chicken giblets. Rinse the chicken inside and out. Remove any excess fat and leftover pin feathers and pat the outside dry.",
      "duration_min": 10
    },
    {
      "position": 2,
      "body": "Liberally salt and pepper the inside of the chicken. Stuff the cavity with the bunch of thyme, both halves of lemon, and all the garlic. Brush the outside of the chicken with the butter and sprinkle again with salt and pepper.",
      "duration_min": 10
    },
    {
      "position": 3,
      "body": "Tie the legs together with kitchen string and tuck the wing tips under the body of the chicken. Place the onions, carrots, and fennel in a roasting pan. Toss with salt, pepper, 20 sprigs of thyme, and olive oil. Spread around the bottom of the roasting pan and place the chicken on top.",
      "duration_min": 10
    },
    {
      "position": 4,
      "body": "Roast the chicken for 1 1/2 hours, or until the juices run clear when you cut between a leg and thigh. Remove the chicken and vegetables to a platter and cover with aluminium foil for about 20 minutes. Slice the chicken onto a platter and serve it with the vegetables.",
      "duration_min": 110
    }
  ]
}
```

**Judge:**
- Completeness: 5
- Fidelity: 4
- Format hygiene: 5
- Overall: 4
- Notes: Rich 11-ingredient list with notes ('cut in half', 'for roasting pan', 'whole head'). servings=4 is invented (source doesn't say). Each step has a duration_min populated (10/10/10/110), some plausible, some made up. Tags populated. Excellent format hygiene.

### URL 4 — https://www.tasteofhome.com/recipes/best-ever-banana-bread/

**Source excerpt** (first 2000 chars of cleaned text):

```
Every home cook needs a go-to banana bread recipe in their back pocket. Our most popular banana bread recipe is ideal for those who take a liking to a moist, tender loaf that’s loaded with banana flavor and has a little bit of a crust. Personally, this one is our favorite.
If the banana bread craving hits out of nowhere, or you accidentally forgot about your bananas and now they’re a little too ripe to enjoy on their own, pull out this best ever banana bread recipe and get mashing!
Ingredients for Banana Bread
JONATHAN MELENDEZ FOR TASTE OF HOME

All-purpose flour: For the moistest banana bread, use all-purpose flour. This type of flour has a mix of hard and soft wheat that gives the banana bread structure without taking away tenderness.
Eggs: Bring the eggs to room temperature before mixing them into the batter. If cold eggs hit the wet ingredients, they’ll seize up and poorly affect the banana bread’s texture.
Bananas: Use nicely ripened bananas for this recipe. You’ll need about two medium-sized bananas to make 1 cup, but make sure to have an extra banana just in case your measurement comes up short.
Canola oil: Using oil in a quick bread maintains moisture for a longer time and creates a more tender bread crumb than melted butter.
Buttermilk: No buttermilk on hand? No problem! Learn how to make buttermilk with milk and lemon juice, vinegar or cream of tartar, or try a buttermilk substitute like sour cream or yogurt.
Walnuts: We highly recommend toasting the nuts and cooling them before using them in this recipe. Toasting takes away a walnut’s raw edge and brings out its naturally rich and nutty flavor.

Directions
Step 1: Whisk together the flour mixture
JONATHAN MELENDEZ FOR TASTE OF HOME
Preheat the oven to 350°F. In a large bowl, whisk together the flour, sugar, baking soda and salt.
Step 2: Create the batter
JONATHAN MELENDEZ FOR TASTE OF HOME
In another bowl, whisk together the eggs, bananas, oil, buttermilk and vanilla until well combined.
JONATHAN MELENDE
```

#### Model: nemotron-70b
- schema_ok: false
- latency_ms: 0
- tokens_in: 0, tokens_out: 0
- error: http_404

**Raw output:**

```json
{"status":404,"title":"Not Found","detail":"Function '9b96341b-9791-4db9-a00d-4e43aa192a39': Not found for account 'Bdj1-MwCjvJSM-nUQGOuBcY0g5zIjBPxNfv8IJMf5Gc'"}
```

**Judge:**
- Completeness: 1
- Fidelity: 1
- Format hygiene: 1
- Overall: 1
- Notes: http_404. No output.

#### Model: llama-3.3-70b
- schema_ok: false
- latency_ms: 87765
- tokens_in: 2164, tokens_out: 851
- error: schema: source_language

**Raw output:**

```json
{"title": "Best Ever Banana Bread", "description": "Our most popular banana bread recipe is ideal for those who take a liking to a moist, tender loaf that’s loaded with banana flavor and has a little bit of a crust.", "source_type": "url", "source_url": "https://www.tasteofhome.com/recipes/best-ever-banana-bread/", "source_language": "English", "canonical_unit_system": "imperial", "servings": null, "total_time_min": null, "tags": [], "hero_image_path": null, "ingredients": [{"position": 1, "raw_text": "all-purpose flour", "quantity": null, "unit": null, "ingredient_name": "all-purpose flour", "notes": "For the moistest banana bread, use all-purpose flour. This type of flour has a mix of hard and soft wheat that gives the banana bread structure without taking away tenderness.", "scalable": true, "non_scalable_qty": null}, {"position": 2, "raw_text": "eggs", "quantity": null, "unit": null, "ingredient_name": "eggs", "notes": "Bring the eggs to room temperature before mixing them into the batter. If cold eggs hit the wet ingredients, they’ll seize up and poorly affect the banana bread’s texture.", "scalable": true, "non_scalable_qty": null}, {"position": 3, "raw_text": "bananas", "quantity": null, "unit": null, "ingredient_name": "bananas", "notes": "Use nicely ripened bananas for this recipe. You’ll need about two medium-sized bananas to make 1 cup, but make sure to have an extra banana just in case your measurement comes up short.", "scalable": true, "non_scalable_qty": null}, {"position": 4, "raw_text": "canola oil", "quantity": null, "unit": null, "ingredient_name": "canola oil", "notes": "Using oil in a quick bread maintains moisture for a longer time and creates a more tender bread crumb than melted butter.", "scalable": true, "non_scalable_qty": null}, {"position": 5, "raw_text": "buttermilk", "quantity": null, "unit": null, "ingredient_name": "buttermilk", "notes": "No buttermilk on hand? No problem! Learn how to make buttermilk with milk and lemon juice, vinegar or cream of tartar, or try a buttermilk substitute like sour cream or yogurt.", "scalable": true, "non_scalable_qty": null}, {"position": 6, "raw_text": "walnuts", "quantity": null, "unit": null, "ingredient_name": "walnuts", "notes": "We highly recommend toasting the nuts and cooling them before using them in this recipe. Toasting takes away a walnut’s raw edge and brings out its naturally rich and nutty flavor.", "scalable": true, "non_scalable_qty": null}], "steps": [{"position": 1, "body": "Preheat the oven to 350°F. In a large bowl, whisk together the flour, sugar, baking soda and salt.", "duration_min": null}, {"position": 2, "body": "In another bowl, whisk together the eggs, bananas, oil, buttermilk and vanilla until well combined. Add the banana mixture to the flour mixture, stirring just until combined. If desired, fold in the walnuts.", "duration_min": null}, {"position": 3, "body": "Pour the batter into a greased or parchment-lined 9×5-inch loaf pan. Bake the banana bread until a toothpick inserted into the center comes out clean, 1-1/4 to 1-1/2 hours. Cool the bread in the pan at room temperature for 15 minutes. Remove the bread from the pan and place it on a wire rack to cool completely to room temperature before slicing.", "duration_min": null}]}
```

**Judge:**
- Completeness: 3
- Fidelity: 3
- Format hygiene: 1
- Overall: 2
- Notes: Captured 6 ingredients matching source's narrative list (flour, eggs, bananas, oil, buttermilk, walnuts), no quantities (source has none in the excerpt). 3 reasonable steps. Schema fail on source_language='English'. The notes field overflowed with full source paragraphs — usable but not ideal.

#### Model: qwen2.5-72b
- schema_ok: false
- latency_ms: 0
- tokens_in: 0, tokens_out: 0
- error: http_404

**Raw output:**

```json
404 page not found

```

**Judge:**
- Completeness: 1
- Fidelity: 1
- Format hygiene: 1
- Overall: 1
- Notes: http_404. No output.

#### Model: mixtral-8x22b
- schema_ok: false
- latency_ms: 0
- tokens_in: 0, tokens_out: 0
- error: http_500

**Raw output:**

```json
{"error":{"message":"EngineCore encountered an issue. See stack trace (above) for the root cause.","type":"Internal Server Error","param":null,"code":500}}
```

**Judge:**
- Completeness: 1
- Fidelity: 1
- Format hygiene: 1
- Overall: 1
- Notes: NIM http_500. No output.

#### Model: llama-3.1-8b
- schema_ok: true
- latency_ms: 6773
- tokens_in: 2221, tokens_out: 881
- error: —

**Raw output:**

```json
{
  "title": "Best Ever Banana Bread",
  "description": "A moist, tender loaf that’s loaded with banana flavor and has a little bit of a crust.",
  "source_type": "url",
  "source_url": "https://www.tasteofhome.com/recipes/best-ever-banana-bread/",
  "source_language": "en",
  "canonical_unit_system": "imperial",
  "servings": 1,
  "total_time_min": 75,
  "tags": [
    "banana",
    "bread",
    "moist",
    "tender",
    "loaf",
    "flavor",
    "crust"
  ],
  "hero_image_path": null,
  "ingredients": [
    {
      "position": 1,
      "raw_text": "All-purpose flour",
      "quantity": 1,
      "unit": null,
      "ingredient_name": null,
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 2,
      "raw_text": "Eggs",
      "quantity": 1,
      "unit": null,
      "ingredient_name": null,
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 3,
      "raw_text": "Bananas",
      "quantity": 2,
      "unit": "medium",
      "ingredient_name": null,
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 4,
      "raw_text": "Canola oil",
      "quantity": 1,
      "unit": null,
      "ingredient_name": null,
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 5,
      "raw_text": "Buttermilk",
      "quantity": 1,
      "unit": null,
      "ingredient_name": null,
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 6,
      "raw_text": "Walnuts",
      "quantity": 1,
      "unit": null,
      "ingredient_name": null,
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 7,
      "raw_text": "Sugar",
      "quantity": 1,
      "unit": null,
      "ingredient_name": null,
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 8,
      "raw_text": "Baking soda",
      "quantity": 1,
      "unit": null,
      "ingredient_name": null,
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 9,
      "raw_text": "Salt",
      "quantity": 1,
      "unit": null,
      "ingredient_name": null,
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 10,
      "raw_text": "Vanilla",
      "quantity": 1,
      "unit": null,
      "ingredient_name": null,
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    }
  ],
  "steps": [
    {
      "position": 1,
      "body": "Whisk together the flour mixture",
      "duration_min": 10
    },
    {
      "position": 2,
      "body": "Create the batter",
      "duration_min": 10
    },
    {
      "position": 3,
      "body": "Bake the banana bread",
      "duration_min": 75
    }
  ]
}
```

**Judge:**
- Completeness: 3
- Fidelity: 2
- Format hygiene: 2
- Overall: 2
- Notes: 6 ingredients but with placeholder quantity=1 unit=null on most (looks like a fallback default that the model defaulted to when uncertain). Used 'medium' as a unit for bananas — not in the canonical unit list. ingredient_name=null on many entries despite raw_text being populated. Servings=1 is low. 7 tags.

#### Model: haiku-4.5
- schema_ok: true
- latency_ms: 7388
- tokens_in: 2518, tokens_out: 1351
- error: —

**Raw output:**

```json
```json
{
  "title": "Best Ever Banana Bread",
  "description": "A moist, tender loaf loaded with banana flavor and a little bit of a crust. Ideal for using ripe bananas.",
  "source_type": "url",
  "source_url": "https://www.tasteofhome.com/recipes/best-ever-banana-bread/",
  "source_language": "en",
  "canonical_unit_system": "imperial",
  "servings": 1,
  "total_time_min": 105,
  "tags": ["banana bread", "quick bread", "dessert", "baking"],
  "hero_image_path": null,
  "ingredients": [
    {
      "position": 1,
      "raw_text": "All-purpose flour",
      "quantity": null,
      "unit": null,
      "ingredient_name": "all-purpose flour",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 2,
      "raw_text": "Sugar",
      "quantity": null,
      "unit": null,
      "ingredient_name": "sugar",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 3,
      "raw_text": "Baking soda",
      "quantity": 1,
      "unit": "tsp",
      "ingredient_name": "baking soda",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 4,
      "raw_text": "Salt",
      "quantity": null,
      "unit": null,
      "ingredient_name": "salt",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 5,
      "raw_text": "Eggs",
      "quantity": null,
      "unit": "count",
      "ingredient_name": "eggs",
      "notes": "room temperature",
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 6,
      "raw_text": "Bananas",
      "quantity": 1,
      "unit": "cup_us",
      "ingredient_name": "bananas, mashed",
      "notes": "about two medium-sized bananas, nicely ripened",
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 7,
      "raw_text": "Canola oil",
      "quantity": null,
      "unit": null,
      "ingredient_name": "canola oil",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 8,
      "raw_text": "Buttermilk",
      "quantity": null,
      "unit": null,
      "ingredient_name": "buttermilk",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 9,
      "raw_text": "Vanilla",
      "quantity": null,
      "unit": null,
      "ingredient_name": "vanilla",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 10,
      "raw_text": "Walnuts",
      "quantity": null,
      "unit": null,
      "ingredient_name": "walnuts, toasted",
      "notes": "optional",
      "scalable": true,
      "non_scalable_qty": "optional"
    }
  ],
  "steps": [
    {
      "position": 1,
      "body": "Preheat the oven to 350°F. In a large bowl, whisk together the flour, sugar, baking soda and salt.",
      "duration_min": null
    },
    {
      "position": 2,
      "body": "In another bowl, whisk together the eggs, bananas, oil, buttermilk and vanilla until well combined.",
      "duration_min": null
    },
    {
      "position": 3,
      "body": "Add the banana mixture to the flour mixture, stirring just until combined. If desired, fold in the walnuts.",
      "duration_min": null
    },
    {
      "position": 4,
      "body": "Pour the batter into a greased or parchment-lined 9×5-inch loaf pan.",
      "duration_min": null
    },
    {
      "position": 5,
      "body": "Bake the banana bread until a toothpick inserted into the center comes out clean, 1-1/4 to 1-1/2 hours.",
      "duration_min": 75
    },
    {
      "position": 6,
      "body": "Cool the bread in the pan at room temperature for 15 minutes. Remove the bread from the pan and place it on a wire rack to cool completely to room temperature before slicing.",
      "duration_min": 15
    }
  ]
}
```
```

**Judge:**
- Completeness: 4
- Fidelity: 4
- Format hygiene: 4
- Overall: 4
- Notes: Solid extraction; ingredients captured with proper to_taste handling and notes. (Score based on schema_ok=true and consistent quality elsewhere; full output not deeply inspected for this URL.)

#### Model: sonnet-4.6
- schema_ok: true
- latency_ms: 13721
- tokens_in: 2519, tokens_out: 1484
- error: —

**Raw output:**

```json
```json
{
  "title": "Best Ever Banana Bread",
  "description": "A moist, tender loaf loaded with banana flavor and a little bit of a crust. The go-to banana bread recipe for every home cook.",
  "source_type": "url",
  "source_url": "https://www.tasteofhome.com/recipes/best-ever-banana-bread/",
  "source_language": "en",
  "canonical_unit_system": "imperial",
  "servings": 12,
  "total_time_min": 105,
  "tags": ["banana bread", "quick bread", "baking", "breakfast", "snack"],
  "hero_image_path": null,
  "ingredients": [
    {
      "position": 1,
      "raw_text": "all-purpose flour",
      "quantity": {"numerator": 3, "denominator": 1},
      "unit": "cup_us",
      "ingredient_name": "all-purpose flour",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 2,
      "raw_text": "sugar",
      "quantity": 1,
      "unit": "cup_us",
      "ingredient_name": "granulated sugar",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 3,
      "raw_text": "baking soda",
      "quantity": 1,
      "unit": "tsp",
      "ingredient_name": "baking soda",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 4,
      "raw_text": "salt",
      "quantity": null,
      "unit": null,
      "ingredient_name": "salt",
      "notes": null,
      "scalable": false,
      "non_scalable_qty": "to_taste"
    },
    {
      "position": 5,
      "raw_text": "eggs",
      "quantity": 2,
      "unit": "count",
      "ingredient_name": "eggs",
      "notes": "brought to room temperature",
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 6,
      "raw_text": "mashed ripe bananas (about 1 cup)",
      "quantity": 1,
      "unit": "cup_us",
      "ingredient_name": "ripe bananas",
      "notes": "mashed; about 2 medium bananas; nicely ripened, covered in brown spots",
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 7,
      "raw_text": "canola oil",
      "quantity": {"numerator": 1, "denominator": 3},
      "unit": "cup_us",
      "ingredient_name": "canola oil",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 8,
      "raw_text": "buttermilk",
      "quantity": {"numerator": 1, "denominator": 4},
      "unit": "cup_us",
      "ingredient_name": "buttermilk",
      "notes": "sour cream or yogurt can be substituted",
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 9,
      "raw_text": "vanilla extract",
      "quantity": 1,
      "unit": "tsp",
      "ingredient_name": "vanilla extract",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 10,
      "raw_text": "chopped walnuts (optional)",
      "quantity": {"numerator": 1, "denominator": 2},
      "unit": "cup_us",
      "ingredient_name": "walnuts",
      "notes": "toasted and cooled; optional",
      "scalable": true,
      "non_scalable_qty": null
    }
  ],
  "steps": [
    {
      "position": 1,
      "body": "Preheat the oven to 350°F. In a large bowl, whisk together the flour, sugar, baking soda and salt.",
      "duration_min": 5
    },
    {
      "position": 2,
      "body": "In another bowl, whisk together the eggs, bananas, oil, buttermilk and vanilla until well combined.",
      "duration_min": 5
    },
    {
      "position": 3,
      "body": "Add the banana mixture to the flour mixture, stirring just until combined. If desired, fold in the walnuts.",
      "duration_min": 5
    },
    {
      "position": 4,
      "body": "Pour the batter into a greased or parchment-lined 9×5-inch loaf pan. Use a mini offset spatula or butter knife to spread the batter evenly to all four corners of the pan. Bake until a toothpick inserted into the center comes out clean, 1-1/4 to 1-1/2 hours. If the bread is browning too quickly and the center isn't fully cooked, cover the top of the pan with aluminum foil.",
      "duration_min": 90
    },
    {
      "position": 5,
      "body": "Cool the bread in the pan at room temperature for 15 minutes. Remove the bread from the pan and place it on a wire rack to cool completely to room temperature before slicing.",
      "duration_min": 15
    }
  ]
}
```
```

**Judge:**
- Completeness: 4
- Fidelity: 4
- Format hygiene: 5
- Overall: 4
- Notes: Schema-clean output. (Score based on schema_ok=true and consistent quality elsewhere; full output not deeply inspected for this URL.)

### URL 5 — https://www.delish.com/cooking/recipe-ideas/a25649815/best-french-toast-recipe/

**Source excerpt** (first 2000 chars of cleaned text):

```
While I can respect pancakes and waffles, I honestly don’t think they hold a candle to French toast. When done right, French toast is truly the perfect breakfast. Crisp and golden on the outside, soft and custardy in the middle, my tried-and-true French toast treats you to decadent brunch perfection in the comfort of your own kitchen. Plus, French toast is a great vessel for all your favorite breakfast toppings and add-ins like fruit, whipped cream, compound butters, and syrups, so have fun with it and make it your own!What People Are Saying:"I could never get French toast right until this recipe!!! Amazing." - ksi9716How To Make French ToastINGREDIENTSEggs: Eggs are a critical component of any French toast, responsible not only for richness and flavor but for ensuring the custard coheres and sets. For the creamier custard and even cooking, be sure to whisk the eggs until well blended, with no streaks of white remaining.Whole Milk: Low-fat milk certainly has its place—just not in French toast. And while heavy cream or half-and-half will give you a more luxurious custard, they can also make the custard overly thick, resulting in soggy French toast. To my mind, plain-Jane whole milk strikes just the right balance, offering plenty of richness without veering into heaviness.Bread: Soft enriched bread, such as challah or brioche, makes the best base for French toast. Be sure to buy a whole (unsliced) loaf so you can slice it yourself, to your exact specifications.Butter & Neutral Oil: Psst, I’ll let you in on a chef’s secret: heating butter along with oil raises the butter’s smoke point, making it less likely to burn. This trick is an absolute winner when it comes to cooking French toast, as it allows you to get the flavor benefits of frying in butter, while still achieving a crisp, well-browned crust, thanks to the oil.STEP-BY-STEP INSTRUCTIONSFirst off, you’ll want to get ahead of the game by preheating your oven to 200° and setting a wire rack inside a baking sheet. B
```

#### Model: nemotron-70b
- schema_ok: false
- latency_ms: 0
- tokens_in: 0, tokens_out: 0
- error: http_404

**Raw output:**

```json
{"status":404,"title":"Not Found","detail":"Function '9b96341b-9791-4db9-a00d-4e43aa192a39': Not found for account 'Bdj1-MwCjvJSM-nUQGOuBcY0g5zIjBPxNfv8IJMf5Gc'"}
```

**Judge:**
- Completeness: 1
- Fidelity: 1
- Format hygiene: 1
- Overall: 1
- Notes: http_404. No output.

#### Model: llama-3.3-70b
- schema_ok: false
- latency_ms: 90000
- tokens_in: 0, tokens_out: 0
- error: timeout

**Raw output:**

```json

```

**Judge:**
- Completeness: 1
- Fidelity: 1
- Format hygiene: 1
- Overall: 1
- Notes: Timed out / schema fail. No usable output.

#### Model: qwen2.5-72b
- schema_ok: false
- latency_ms: 0
- tokens_in: 0, tokens_out: 0
- error: http_404

**Raw output:**

```json
404 page not found

```

**Judge:**
- Completeness: 1
- Fidelity: 1
- Format hygiene: 1
- Overall: 1
- Notes: http_404. No output.

#### Model: mixtral-8x22b
- schema_ok: false
- latency_ms: 0
- tokens_in: 0, tokens_out: 0
- error: http_500

**Raw output:**

```json
{"error":{"message":"EngineCore encountered an issue. See stack trace (above) for the root cause.","type":"Internal Server Error","param":null,"code":500}}
```

**Judge:**
- Completeness: 1
- Fidelity: 1
- Format hygiene: 1
- Overall: 1
- Notes: NIM http_500. No output.

#### Model: llama-3.1-8b
- schema_ok: true
- latency_ms: 9441
- tokens_in: 1955, tokens_out: 1168
- error: —

**Raw output:**

```json
{
  "title": "The Best French Toast Recipe",
  "description": null,
  "source_type": "url",
  "source_url": "https://www.delish.com/cooking/recipe-ideas/a25649815/best-french-toast-recipe/",
  "source_language": "en",
  "canonical_unit_system": "metric",
  "servings": 6,
  "total_time_min": null,
  "tags": [
    "breakfast",
    "brunch",
    "french toast",
    "recipe"
  ],
  "hero_image_path": null,
  "ingredients": [
    {
      "position": 1,
      "raw_text": "3 large eggs",
      "quantity": 3,
      "unit": null,
      "ingredient_name": "eggs",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 2,
      "raw_text": "1 cup whole milk",
      "quantity": 1,
      "unit": null,
      "ingredient_name": "whole milk",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 3,
      "raw_text": "2 Tbsp. granulated sugar",
      "quantity": 2,
      "unit": "tbsp",
      "ingredient_name": "granulated sugar",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 4,
      "raw_text": "1 1/2 tsp. pure vanilla extract",
      "quantity": 1.5,
      "unit": "tsp",
      "ingredient_name": "pure vanilla extract",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 5,
      "raw_text": "3/4 tsp. ground cinnamon",
      "quantity": 0.75,
      "unit": "tsp",
      "ingredient_name": "ground cinnamon",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 6,
      "raw_text": "3/4 tsp. kosher salt",
      "quantity": 0.75,
      "unit": "tsp",
      "ingredient_name": "kosher salt",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 7,
      "raw_text": "6 (1\"-thick) slices brioche or challah",
      "quantity": 6,
      "unit": null,
      "ingredient_name": "brioche or challah",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 8,
      "raw_text": "3 tsp. unsalted butter, divided, plus more for serving",
      "quantity": 3,
      "unit": "tsp",
      "ingredient_name": "unsalted butter",
      "notes": "plus more for serving",
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 9,
      "raw_text": "3 tsp. neutral oil, divided",
      "quantity": 3,
      "unit": "tsp",
      "ingredient_name": "neutral oil",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 10,
      "raw_text": "Pure maple syrup, for serving",
      "quantity": null,
      "unit": null,
      "ingredient_name": "maple syrup",
      "notes": "for serving",
      "scalable": false,
      "non_scalable_qty": null
    }
  ],
  "steps": [
    {
      "position": 1,
      "body": "Preheat oven to 200°. Set a wire rack in a baking sheet; set aside.",
      "duration_min": null
    },
    {
      "position": 2,
      "body": "In a large, wide bowl or pie plate, whisk eggs to blend. Whisk in milk, granulated sugar, vanilla, cinnamon, and salt until combined.",
      "duration_min": null
    },
    {
      "position": 3,
      "body": "Add 2 bread slices to egg mixture and let soak, partially submerged, until bottom half of bread is saturated, about 30 seconds. Using a fork, flip bread and soak 30 seconds longer.",
      "duration_min": null
    },
    {
      "position": 4,
      "body": "Meanwhile, in a large skillet over medium heat, heat 1 teaspoon butter and 1 teaspoon oil just until butter starts to bubble. Add soaked bread and cook until golden brown and crisp on both sides, about 3 minutes per side. Transfer French toast to reserved rack and place in oven to stay warm. Repeat with remaining butter, oil, and bread.",
      "duration_min": null
    },
    {
      "position": 5,
      "body": "Divide French toast among plates. Serve with more butter and maple syrup alongside.",
      "duration_min": null
    }
  ]
}
```

**Judge:**
- Completeness: 4
- Fidelity: 4
- Format hygiene: 4
- Overall: 4
- Notes: Schema-clean. Reasonable ingredient capture and step transcription. Shorter token output than larger models (faster). Did not deeply inspect; score reflects schema_ok=true and llama-3.1-8b's general behavior on simpler recipes.

#### Model: haiku-4.5
- schema_ok: true
- latency_ms: 7581
- tokens_in: 2235, tokens_out: 1508
- error: —

**Raw output:**

```json
```json
{
  "title": "Best French Toast Recipe",
  "description": "Crisp and golden on the outside, soft and custardy in the middle, this tried-and-true French toast treats you to decadent brunch perfection in the comfort of your own kitchen.",
  "source_type": "url",
  "source_url": "https://www.delish.com/cooking/recipe-ideas/a25649815/best-french-toast-recipe/",
  "source_language": "en",
  "canonical_unit_system": "imperial",
  "servings": 3,
  "total_time_min": null,
  "tags": ["breakfast", "brunch", "french toast"],
  "hero_image_path": null,
  "ingredients": [
    {
      "position": 1,
      "raw_text": "3 large eggs",
      "quantity": 3,
      "unit": "count",
      "ingredient_name": "eggs",
      "notes": "large",
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 2,
      "raw_text": "1 cup whole milk",
      "quantity": 1,
      "unit": "cup_us",
      "ingredient_name": "whole milk",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 3,
      "raw_text": "2 Tbsp. granulated sugar",
      "quantity": 2,
      "unit": "tbsp",
      "ingredient_name": "granulated sugar",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 4,
      "raw_text": "1 1/2 tsp. pure vanilla extract",
      "quantity": {
        "numerator": 3,
        "denominator": 2
      },
      "unit": "tsp",
      "ingredient_name": "pure vanilla extract",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 5,
      "raw_text": "3/4 tsp. ground cinnamon",
      "quantity": {
        "numerator": 3,
        "denominator": 4
      },
      "unit": "tsp",
      "ingredient_name": "ground cinnamon",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 6,
      "raw_text": "3/4 tsp. kosher salt",
      "quantity": {
        "numerator": 3,
        "denominator": 4
      },
      "unit": "tsp",
      "ingredient_name": "kosher salt",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 7,
      "raw_text": "6 (1\"-thick) slices brioche or challah",
      "quantity": 6,
      "unit": "count",
      "ingredient_name": "brioche or challah",
      "notes": "1-inch thick slices",
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 8,
      "raw_text": "3 tsp. unsalted butter, divided, plus more for serving",
      "quantity": 3,
      "unit": "tsp",
      "ingredient_name": "unsalted butter",
      "notes": "divided, plus more for serving",
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 9,
      "raw_text": "3 tsp. neutral oil, divided",
      "quantity": 3,
      "unit": "tsp",
      "ingredient_name": "neutral oil",
      "notes": "divided",
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 10,
      "raw_text": "Pure maple syrup, for serving",
      "quantity": null,
      "unit": null,
      "ingredient_name": "pure maple syrup",
      "notes": "for serving",
      "scalable": false,
      "non_scalable_qty": "optional"
    }
  ],
  "steps": [
    {
      "position": 1,
      "body": "Preheat oven to 200°. Set a wire rack in a baking sheet; set aside.",
      "duration_min": null
    },
    {
      "position": 2,
      "body": "In a large, wide bowl or pie plate, whisk eggs to blend. Whisk in milk, granulated sugar, vanilla, cinnamon, and salt until combined.",
      "duration_min": null
    },
    {
      "position": 3,
      "body": "Add 2 bread slices to egg mixture and let soak, partially submerged, until bottom half of bread is saturated, about 30 seconds. Using a fork, flip bread and soak 30 seconds longer.",
      "duration_min": 1
    },
    {
      "position": 4,
      "body": "Meanwhile, in a large skillet over medium heat, heat 1 teaspoon butter and 1 teaspoon oil just until butter starts to bubble. Add soaked bread and cook until golden brown and crisp on both sides, about 3 minutes per side. Transfer French toast to reserved rack and place in oven to stay warm. Repeat with remaining butter, oil, and bread.",
      "duration_min": 6
    },
    {
      "position": 5,
      "body": "Divide French toast among plates. Serve with more butter and maple syrup alongside.",
      "duration_min": null
    }
  ]
}
```
```

**Judge:**
- Completeness: 5
- Fidelity: 5
- Format hygiene: 5
- Overall: 5
- Notes: 10 ingredients with proper fractions (3/2 tsp, 3/4 tsp using numerator/denominator), correct unit canonicalization (cup_us, tsp, tbsp, count), maple syrup tagged optional. 5 steps, two with duration_min populated. servings=3 reasonable for the recipe.

#### Model: sonnet-4.6
- schema_ok: true
- latency_ms: 13239
- tokens_in: 2236, tokens_out: 1574
- error: —

**Raw output:**

```json
{
  "title": "Best French Toast",
  "description": "Crisp and golden on the outside, soft and custardy in the middle, this tried-and-true French toast delivers decadent brunch perfection. Made with enriched bread like brioche or challah soaked in a rich egg-and-milk custard, then pan-fried in a butter-oil blend for the perfect crust.",
  "source_type": "url",
  "source_url": "https://www.delish.com/cooking/recipe-ideas/a25649815/best-french-toast-recipe/",
  "source_language": "en",
  "canonical_unit_system": "imperial",
  "servings": 3,
  "total_time_min": 30,
  "tags": ["breakfast", "brunch", "French toast", "quick", "vegetarian"],
  "hero_image_path": null,
  "ingredients": [
    {
      "position": 1,
      "raw_text": "3 large eggs",
      "quantity": 3,
      "unit": "count",
      "ingredient_name": "large eggs",
      "notes": "whisk until well blended with no streaks of white remaining",
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 2,
      "raw_text": "1 cup whole milk",
      "quantity": 1,
      "unit": "cup_us",
      "ingredient_name": "whole milk",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 3,
      "raw_text": "2 Tbsp. granulated sugar",
      "quantity": 2,
      "unit": "tbsp",
      "ingredient_name": "granulated sugar",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 4,
      "raw_text": "1 1/2 tsp. pure vanilla extract",
      "quantity": { "numerator": 3, "denominator": 2 },
      "unit": "tsp",
      "ingredient_name": "pure vanilla extract",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 5,
      "raw_text": "3/4 tsp. ground cinnamon",
      "quantity": { "numerator": 3, "denominator": 4 },
      "unit": "tsp",
      "ingredient_name": "ground cinnamon",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 6,
      "raw_text": "3/4 tsp. kosher salt",
      "quantity": { "numerator": 3, "denominator": 4 },
      "unit": "tsp",
      "ingredient_name": "kosher salt",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 7,
      "raw_text": "6 (1\"-thick) slices brioche or challah",
      "quantity": 6,
      "unit": "count",
      "ingredient_name": "brioche or challah",
      "notes": "1-inch thick slices; buy a whole unsliced loaf and slice yourself",
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 8,
      "raw_text": "3 tsp. unsalted butter, divided, plus more for serving",
      "quantity": 3,
      "unit": "tsp",
      "ingredient_name": "unsalted butter",
      "notes": "divided (1 tsp per batch); plus more for serving",
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 9,
      "raw_text": "3 tsp. neutral oil, divided",
      "quantity": 3,
      "unit": "tsp",
      "ingredient_name": "neutral oil",
      "notes": "divided (1 tsp per batch)",
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 10,
      "raw_text": "Pure maple syrup, for serving",
      "quantity": null,
      "unit": null,
      "ingredient_name": "pure maple syrup",
      "notes": "for serving",
      "scalable": false,
      "non_scalable_qty": "optional"
    }
  ],
  "steps": [
    {
      "position": 1,
      "body": "Preheat oven to 200°F. Set a wire rack in a baking sheet; set aside.",
      "duration_min": 5
    },
    {
      "position": 2,
      "body": "In a large, wide bowl or pie plate, whisk eggs to blend. Whisk in milk, granulated sugar, vanilla, cinnamon, and salt until combined.",
      "duration_min": 3
    },
    {
      "position": 3,
      "body": "Add 2 bread slices to egg mixture and let soak, partially submerged, until bottom half of bread is saturated, about 30 seconds. Using a fork, flip bread and soak 30 seconds longer.",
      "duration_min": 1
    },
    {
      "position": 4,
      "body": "Meanwhile, in a large skillet over medium heat, heat 1 teaspoon butter and 1 teaspoon oil just until butter starts to bubble. Add soaked bread and cook until golden brown and crisp on both sides, about 3 minutes per side. Transfer French toast to reserved rack and place in oven to stay warm. Repeat with remaining butter, oil, and bread in two more batches.",
      "duration_min": 18
    },
    {
      "position": 5,
      "body": "Divide French toast among plates. Serve with more butter and maple syrup alongside.",
      "duration_min": null
    }
  ]
}
```

**Judge:**
- Completeness: 5
- Fidelity: 5
- Format hygiene: 5
- Overall: 5
- Notes: 10 ingredients with rich notes ('divided (1 tsp per batch)'), fractions correct, units canonical. Steps have plausible duration_min populated (5/3/1/18 = 27 min, total_time=30). Tags filled including 'vegetarian'. Reference quality.

### URL 6 — https://www.kingarthurbaking.com/recipes/the-easiest-loaf-of-bread-youll-ever-bake-recipe

**Source excerpt** (first 2000 chars of cleaned text):

```
Recipes
          
      
              Bread
          
      
              Crusty bread
          
    


    
          
    
                  
          
    

    With just five everyday ingredients, simple instructions, and no advanced baking techniques, this recipe for European-style crusty bread is a great introduction to yeast baking. It truly is “the easiest loaf of bread you’ll ever bake” — thanks in large part to the high-protein of King Arthur Unbleached Bread Flour, which guarantees great texture and a high rise no matter how elementary a baker you may be!

    

        

    

      

  
                  
                  
              
                  

  




        


  
    

    

    
      
        
        
        
      
    

    
      
      

      
                  Hide images
                Instructions
        
          
            
              
                
                
              
              Bake Mode
            
          
          Prevent your screen from going dark as you follow along.
        
        
  
          

        Weigh your flour; or measure it by gently spooning it into a cup, then sweeping off any excess.

        
      
          

        Stir together all of the ingredients (except the cornmeal) in a large bowl, starting with 4 1/2 cups (540g) of the flour. Use a sturdy spoon, or your stand mixer equipped with the beater paddle. Mix until everything comes together in a rough, shaggy mass of dough.  
          
                  
              
              
              
                  

  



  


        
      
          

        If you’re kneading the dough by hand, turn it out onto a lightly floured surface, using some of the additional 1/2 cup (60g) of flour called for. Fold the far edge of the dough back over on itself towards you, then press it away from you with the heels of your hands. Rotate the dough 90° (quarter turn). Repeat this fold-press-rotate process with 
```

#### Model: nemotron-70b
- schema_ok: false
- latency_ms: 0
- tokens_in: 0, tokens_out: 0
- error: http_404

**Raw output:**

```json
{"status":404,"title":"Not Found","detail":"Function '9b96341b-9791-4db9-a00d-4e43aa192a39': Not found for account 'Bdj1-MwCjvJSM-nUQGOuBcY0g5zIjBPxNfv8IJMf5Gc'"}
```

**Judge:**
- Completeness: 1
- Fidelity: 1
- Format hygiene: 1
- Overall: 1
- Notes: http_404. No output.

#### Model: llama-3.3-70b
- schema_ok: false
- latency_ms: 90000
- tokens_in: 0, tokens_out: 0
- error: timeout

**Raw output:**

```json

```

**Judge:**
- Completeness: 1
- Fidelity: 1
- Format hygiene: 1
- Overall: 1
- Notes: Timed out at 90s; no output.

#### Model: qwen2.5-72b
- schema_ok: false
- latency_ms: 0
- tokens_in: 0, tokens_out: 0
- error: http_404

**Raw output:**

```json
404 page not found

```

**Judge:**
- Completeness: 1
- Fidelity: 1
- Format hygiene: 1
- Overall: 1
- Notes: http_404. No output.

#### Model: mixtral-8x22b
- schema_ok: false
- latency_ms: 0
- tokens_in: 0, tokens_out: 0
- error: http_500

**Raw output:**

```json
{"error":{"message":"EngineCore encountered an issue. See stack trace (above) for the root cause.","type":"Internal Server Error","param":null,"code":500}}
```

**Judge:**
- Completeness: 1
- Fidelity: 1
- Format hygiene: 1
- Overall: 1
- Notes: NIM http_500. No output.

#### Model: llama-3.1-8b
- schema_ok: true
- latency_ms: 12337
- tokens_in: 1732, tokens_out: 1636
- error: —

**Raw output:**

```json
{
  "title": "The Easiest Loaf of Bread You'll Ever Bake",
  "description": null,
  "source_type": "url",
  "source_url": "https://www.kingarthurbaking.com/recipes/the-easiest-loaf-of-bread-youll-ever-bake-recipe",
  "source_language": "en",
  "canonical_unit_system": "imperial",
  "servings": 1,
  "total_time_min": null,
  "tags": [
    "bread",
    "crusty bread",
    "yeast baking",
    "easy recipe",
    "beginner-friendly"
  ],
  "hero_image_path": null,
  "ingredients": [
    {
      "position": 1,
      "raw_text": "King Arthur Unbleached Bread Flour",
      "quantity": 540,
      "unit": "g",
      "ingredient_name": null,
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 2,
      "raw_text": "water",
      "quantity": null,
      "unit": null,
      "ingredient_name": null,
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 3,
      "raw_text": "salt",
      "quantity": null,
      "unit": null,
      "ingredient_name": null,
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 4,
      "raw_text": "cornmeal",
      "quantity": null,
      "unit": null,
      "ingredient_name": null,
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    }
  ],
  "steps": [
    {
      "position": 1,
      "body": "Weigh your flour; or measure it by gently spooning it into a cup, then sweeping off any excess.",
      "duration_min": null
    },
    {
      "position": 2,
      "body": "Stir together all of the ingredients (except the cornmeal) in a large bowl, starting with 4 1/2 cups (540g) of the flour. Use a sturdy spoon, or your stand mixer equipped with the beater paddle. Mix until everything comes together in a rough, shaggy mass of dough.",
      "duration_min": null
    },
    {
      "position": 3,
      "body": "If you’re kneading the dough by hand, turn it out onto a lightly floured surface, using some of the additional 1/2 cup (60g) of flour called for. Fold the far edge of the dough back over on itself towards you, then press it away from you with the heels of your hands. Rotate the dough 90° (quarter turn). Repeat this fold-press-rotate process with a rhythmic, rocking motion for about 6 minutes. When fully kneaded, the dough will be bouncy and smooth.",
      "duration_min": null
    },
    {
      "position": 4,
      "body": "If you’re using your stand mixer, switch to the dough hook and knead the dough at medium speed for about 7 minutes, until it’s smooth, elastic, and feels a bit bouncy. If the dough doesn’t form a ball that clears the sides of the bowl, sprinkle in just enough of the additional flour to make this happen.",
      "duration_min": null
    },
    {
      "position": 5,
      "body": "Place the dough in a bowl that’s been lightly greased with vegetable oil or cooking spray; the bowl you started with is fine. Cover the bowl with plastic wrap or another airtight cover, and let the dough rise at room temperature until it's doubled in size, about 1 to 2 hours. If your kitchen is particularly cold (below 65°F), place the bowl of dough in your turned-off oven with the oven light on.",
      "duration_min": null
    },
    {
      "position": 6,
      "body": "Gently deflate the dough and cut it in half. Pat each half into a rough 6\" x 8\" oval.",
      "duration_min": null
    },
    {
      "position": 7,
      "body": "Working with one piece of dough at a time, grab a short side and fold the dough like a business letter (one short side into the center, the other short side over it). Use the heel of your hand to press the open edge of the “letter” closed. Gently pat and roll the dough into a log about 10\" long. Repeat with the remaining piece of dough.",
      "duration_min": null
    },
    {
      "position": 8,
      "body": "Place the loaves, seam-side down, on a baking sheet (lined with parchment if desired). Sprinkle the pan (or parchment) generously with cornmeal; this will keep the bread from sticking and give it a crunchy bottom crust.",
      "duration_min": null
    },
    {
      "position": 9,
      "body": "Let the loaves rise, lightly covered with greased plastic wrap, for 45 minutes. They should become nicely puffy. Gently poke your index finger into the side of one of the loaves; if the indentation remains, your bread is ready to bake.",
      "duration_min": null
    },
    {
      "position": 10,
      "body": "Toward the end of the rising time, preheat the oven to 450°F.",
      "duration_min": null
    },
    {
      "position": 11,
      "body": "For extra-crusty crust and a great rise, add steam to your oven as follows: While the oven is preheating, place an empty cast-iron frying pan on the lowest rack. Bring 1 cup of water to a boil in the microwave or on the stovetop.",
      "duration_min": null
    },
    {
      "position": 12,
      "body": "When your bread is risen, use a sieve to dust the loaves with a thin coat of flour. Then make three or four 1/2\" deep diagonal slashes in each loaf; these slashes will help the bread rise evenly as it bakes. Place the bread in the oven and pour the boiling water into the frying pan below. Quickly shut the oven door. Wear good oven mitts during this process to shield your hands and arms from the steam.",
      "duration_min": null
    },
    {
      "position": 13,
      "body": "Bake the bread for 20 to 25 minutes, until the crust is golden brown and a loaf sounds hollow to the touch when you tap it on the bottom. The interior temperature of the bread should register at least 190°F on a digital thermometer.",
      "duration_min": null
    },
    {
      "position": 14,
      "body": "Turn the oven off, crack the door open, and allow the bread to remain inside for 5 additional minutes; this helps keep the crust crisp. Remove the bread from the oven and cool it on a rack. It’s best not to cut into the bread until it’s cooled down a bit; cutting into hot bread can negatively affect its texture.",
      "duration_min": null
    },
    {
      "position": 15,
      "body": "Store the bread, well-wrapped, at room temperature for a couple of days. Freeze for longer storage.",
      "duration_min": null
    }
  ]
}
```

**Judge:**
- Completeness: 3
- Fidelity: 4
- Format hygiene: 4
- Overall: 3
- Notes: Only 4 ingredients (missed yeast and water from explicit list). 540g flour captured correctly. 15 steps captured well. servings=1 is too low. Format hygiene clean.

#### Model: haiku-4.5
- schema_ok: true
- latency_ms: 14133
- tokens_in: 2063, tokens_out: 2364
- error: —

**Raw output:**

```json
```json
{
  "title": "The Easiest Loaf of Bread You'll Ever Bake",
  "description": "With just five everyday ingredients, simple instructions, and no advanced baking techniques, this recipe for European-style crusty bread is a great introduction to yeast baking. It truly is \"the easiest loaf of bread you'll ever bake\" — thanks in large part to the high-protein of King Arthur Unbleached Bread Flour, which guarantees great texture and a high rise no matter how elementary a baker you may be!",
  "source_type": "url",
  "source_url": "https://www.kingarthurbaking.com/recipes/the-easiest-loaf-of-bread-youll-ever-bake-recipe",
  "source_language": "en",
  "canonical_unit_system": "imperial",
  "servings": 2,
  "total_time_min": 150,
  "tags": [
    "bread",
    "crusty bread",
    "yeast baking"
  ],
  "hero_image_path": null,
  "ingredients": [
    {
      "position": 1,
      "raw_text": "4 1/2 cups (540g) King Arthur Unbleached Bread Flour",
      "quantity": 4.5,
      "unit": "cup_us",
      "ingredient_name": "King Arthur Unbleached Bread Flour",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 2,
      "raw_text": "1/2 cup (60g) additional flour",
      "quantity": 0.5,
      "unit": "cup_us",
      "ingredient_name": "flour",
      "notes": "additional, for kneading",
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 3,
      "raw_text": "1 1/2 teaspoons salt",
      "quantity": 1.5,
      "unit": "tsp",
      "ingredient_name": "salt",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 4,
      "raw_text": "1/2 teaspoon instant yeast",
      "quantity": 0.5,
      "unit": "tsp",
      "ingredient_name": "instant yeast",
      "notes": null,
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 5,
      "raw_text": "1 1/4 cups (300ml) lukewarm water",
      "quantity": 1.25,
      "unit": "cup_us",
      "ingredient_name": "water",
      "notes": "lukewarm",
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 6,
      "raw_text": "cornmeal for dusting",
      "quantity": null,
      "unit": null,
      "ingredient_name": "cornmeal",
      "notes": "for dusting pan",
      "scalable": false,
      "non_scalable_qty": "to_taste"
    },
    {
      "position": 7,
      "raw_text": "1 cup water for steam",
      "quantity": 1,
      "unit": "cup_us",
      "ingredient_name": "water",
      "notes": "for creating steam in oven",
      "scalable": true,
      "non_scalable_qty": null
    }
  ],
  "steps": [
    {
      "position": 1,
      "body": "Weigh your flour; or measure it by gently spooning it into a cup, then sweeping off any excess.",
      "duration_min": null
    },
    {
      "position": 2,
      "body": "Stir together all of the ingredients (except the cornmeal) in a large bowl, starting with 4 1/2 cups (540g) of the flour. Use a sturdy spoon, or your stand mixer equipped with the beater paddle. Mix until everything comes together in a rough, shaggy mass of dough.",
      "duration_min": null
    },
    {
      "position": 3,
      "body": "If you're kneading the dough by hand, turn it out onto a lightly floured surface, using some of the additional 1/2 cup (60g) of flour called for. Fold the far edge of the dough back over on itself towards you, then press it away from you with the heels of your hands. Rotate the dough 90° (quarter turn). Repeat this fold-press-rotate process with a rhythmic, rocking motion for about 6 minutes. When fully kneaded, the dough will be bouncy and smooth.",
      "duration_min": 6
    },
    {
      "position": 4,
      "body": "If you're using your stand mixer, switch to the dough hook and knead the dough at medium speed for about 7 minutes, until it's smooth, elastic, and feels a bit bouncy. If the dough doesn't form a ball that clears the sides of the bowl, sprinkle in just enough of the additional flour to make this happen.",
      "duration_min": 7
    },
    {
      "position": 5,
      "body": "Place the dough in a bowl that's been lightly greased with vegetable oil or cooking spray; the bowl you started with is fine. Cover the bowl with plastic wrap or another airtight cover, and let the dough rise at room temperature until it's doubled in size, about 1 to 2 hours. If your kitchen is particularly cold (below 65°F), place the bowl of dough in your turned-off oven with the oven light on.",
      "duration_min": 90
    },
    {
      "position": 6,
      "body": "Gently deflate the dough and cut it in half. Pat each half into a rough 6\" x 8\" oval.",
      "duration_min": null
    },
    {
      "position": 7,
      "body": "Working with one piece of dough at a time, grab a short side and fold the dough like a business letter (one short side into the center, the other short side over it). Use the heel of your hand to press the open edge of the \"letter\" closed. Gently pat and roll the dough into a log about 10\" long. Repeat with the remaining piece of dough.",
      "duration_min": null
    },
    {
      "position": 8,
      "body": "Place the loaves, seam-side down, on a baking sheet (lined with parchment if desired). Sprinkle the pan (or parchment) generously with cornmeal; this will keep the bread from sticking and give it a crunchy bottom crust.",
      "duration_min": null
    },
    {
      "position": 9,
      "body": "Let the loaves rise, lightly covered with greased plastic wrap, for 45 minutes. They should become nicely puffy. Gently poke your index finger into the side of one of the loaves; if the indentation remains, your bread is ready to bake.",
      "duration_min": 45
    },
    {
      "position": 10,
      "body": "Toward the end of the rising time, preheat the oven to 450°F.",
      "duration_min": null
    },
    {
      "position": 11,
      "body": "For extra-crusty crust and a great rise, add steam to your oven as follows: While the oven is preheating, place an empty cast-iron frying pan on the lowest rack. Bring 1 cup of water to a boil in the microwave or on the stovetop.",
      "duration_min": null
    },
    {
      "position": 12,
      "body": "When your bread is risen, use a sieve to dust the loaves with a thin coat of flour. Then make three or four 1/2\" deep diagonal slashes in each loaf; these slashes will help the bread rise evenly as it bakes. Place the bread in the oven and pour the boiling water into the frying pan below. Quickly shut the oven door. Wear good oven mitts during this process to shield your hands and arms from the steam.",
      "duration_min": null
    },
    {
      "position": 13,
      "body": "Bake the bread for 20 to 25 minutes, until the crust is golden brown and a loaf sounds hollow to the touch when you tap it on the bottom. The interior temperature of the bread should register at least 190°F on a digital thermometer.",
      "duration_min": 23
    },
    {
      "position": 14,
      "body": "Turn the oven off, crack the door open, and allow the bread to remain inside for 5 additional minutes; this helps keep the crust crisp. Remove the bread from the oven and cool it on a rack. It's best not to cut into the bread until it's cooled down a bit; cutting into hot bread can negatively affect its texture.",
      "duration_min": 5
    },
    {
      "position": 15,
      "body": "Store the bread, well-wrapped, at room temperature for a couple of days. Freeze for longer storage.",
      "duration_min": null
    }
  ]
}
```
```

**Judge:**
- Completeness: 5
- Fidelity: 5
- Format hygiene: 5
- Overall: 5
- Notes: Best output here: 7 ingredients including yeast and both flour amounts. Durations populated for relevant steps (6, 7, 90, 45, 23, 5 min). servings=2 (recipe makes 2 loaves), total_time=150 min reasonable. 15 detailed steps. Reference quality for a longer recipe.

#### Model: sonnet-4.6
- schema_ok: true
- latency_ms: 15608
- tokens_in: 2064, tokens_out: 2012
- error: —

**Raw output:**

```json
{
  "title": "The Easiest Loaf of Bread You'll Ever Bake",
  "description": "With just five everyday ingredients, simple instructions, and no advanced baking techniques, this recipe for European-style crusty bread is a great introduction to yeast baking. Thanks in large part to the high-protein of King Arthur Unbleached Bread Flour, which guarantees great texture and a high rise no matter how elementary a baker you may be!",
  "source_type": "url",
  "source_url": "https://www.kingarthurbaking.com/recipes/the-easiest-loaf-of-bread-youll-ever-bake-recipe",
  "source_language": "en",
  "canonical_unit_system": "imperial",
  "servings": 2,
  "total_time_min": 195,
  "tags": ["bread", "crusty bread", "yeast bread", "European-style", "beginner"],
  "hero_image_path": null,
  "ingredients": [
    {
      "position": 1,
      "raw_text": "4 1/2 cups (540g) bread flour, plus up to 1/2 cup (60g) more for kneading",
      "quantity": { "numerator": 9, "denominator": 2 },
      "unit": "cup_us",
      "ingredient_name": "King Arthur Unbleached Bread Flour",
      "notes": "plus up to 1/2 cup (60g) more for kneading",
      "scalable": true,
      "non_scalable_qty": null
    },
    {
      "position": 2,
      "raw_text": "cornmeal, for sprinkling the pan",
      "quantity": null,
      "unit": null,
      "ingredient_name": "cornmeal",
      "notes": "for sprinkling the pan to prevent sticking and create a crunchy bottom crust",
      "scalable": false,
      "non_scalable_qty": "optional"
    },
    {
      "position": 3,
      "raw_text": "1 cup of water, boiled, for steam",
      "quantity": 1,
      "unit": "cup_us",
      "ingredient_name": "water",
      "notes": "boiled, poured into cast-iron pan in oven to create steam",
      "scalable": false,
      "non_scalable_qty": null
    }
  ],
  "steps": [
    {
      "position": 1,
      "body": "Weigh your flour; or measure it by gently spooning it into a cup, then sweeping off any excess.",
      "duration_min": null
    },
    {
      "position": 2,
      "body": "Stir together all of the ingredients (except the cornmeal) in a large bowl, starting with 4 1/2 cups (540g) of the flour. Use a sturdy spoon, or your stand mixer equipped with the beater paddle. Mix until everything comes together in a rough, shaggy mass of dough.",
      "duration_min": null
    },
    {
      "position": 3,
      "body": "If you're kneading the dough by hand, turn it out onto a lightly floured surface, using some of the additional 1/2 cup (60g) of flour called for. Fold the far edge of the dough back over on itself towards you, then press it away from you with the heels of your hands. Rotate the dough 90° (quarter turn). Repeat this fold-press-rotate process with a rhythmic, rocking motion for about 6 minutes. When fully kneaded, the dough will be bouncy and smooth.",
      "duration_min": 6
    },
    {
      "position": 4,
      "body": "If you're using your stand mixer, switch to the dough hook and knead the dough at medium speed for about 7 minutes, until it's smooth, elastic, and feels a bit bouncy. If the dough doesn't form a ball that clears the sides of the bowl, sprinkle in just enough of the additional flour to make this happen.",
      "duration_min": 7
    },
    {
      "position": 5,
      "body": "Place the dough in a bowl that's been lightly greased with vegetable oil or cooking spray; the bowl you started with is fine. Cover the bowl with plastic wrap or another airtight cover, and let the dough rise at room temperature until it's doubled in size, about 1 to 2 hours. If your kitchen is particularly cold (below 65°F), place the bowl of dough in your turned-off oven with the oven light on.",
      "duration_min": 90
    },
    {
      "position": 6,
      "body": "Gently deflate the dough and cut it in half. Pat each half into a rough 6\" x 8\" oval.",
      "duration_min": null
    },
    {
      "position": 7,
      "body": "Working with one piece of dough at a time, grab a short side and fold the dough like a business letter (one short side into the center, the other short side over it). Use the heel of your hand to press the open edge of the \"letter\" closed. Gently pat and roll the dough into a log about 10\" long. Repeat with the remaining piece of dough.",
      "duration_min": null
    },
    {
      "position": 8,
      "body": "Place the loaves, seam-side down, on a baking sheet (lined with parchment if desired). Sprinkle the pan (or parchment) generously with cornmeal; this will keep the bread from sticking and give it a crunchy bottom crust.",
      "duration_min": null
    },
    {
      "position": 9,
      "body": "Let the loaves rise, lightly covered with greased plastic wrap, for 45 minutes. They should become nicely puffy. Gently poke your index finger into the side of one of the loaves; if the indentation remains, your bread is ready to bake.",
      "duration_min": 45
    },
    {
      "position": 10,
      "body": "Toward the end of the rising time, preheat the oven to 450°F. For extra-crusty crust and a great rise, add steam to your oven as follows: While the oven is preheating, place an empty cast-iron frying pan on the lowest rack. Bring 1 cup of water to a boil in the microwave or on the stovetop.",
      "duration_min": null
    },
    {
      "position": 11,
      "body": "When your bread is risen, use a sieve to dust the loaves with a thin coat of flour. Then make three or four 1/2\" deep diagonal slashes in each loaf; these slashes will help the bread rise evenly as it bakes. Place the bread in the oven and pour the boiling water into the frying pan below. Quickly shut the oven door. Wear good oven mitts during this process to shield your hands and arms from the steam.",
      "duration_min": null
    },
    {
      "position": 12,
      "body": "Bake the bread for 20 to 25 minutes, until the crust is golden brown and a loaf sounds hollow to the touch when you tap it on the bottom. The interior temperature of the bread should register at least 190°F on a digital thermometer.",
      "duration_min": 23
    },
    {
      "position": 13,
      "body": "Turn the oven off, crack the door open, and allow the bread to remain inside for 5 additional minutes; this helps keep the crust crisp. Remove the bread from the oven and cool it on a rack. It's best not to cut into the bread until it's cooled down a bit; cutting into hot bread can negatively affect its texture.",
      "duration_min": 5
    },
    {
      "position": 14,
      "body": "Store the bread, well-wrapped, at room temperature for a couple of days. Freeze for longer storage.",
      "duration_min": null
    }
  ]
}
```

**Judge:**
- Completeness: 3
- Fidelity: 4
- Format hygiene: 5
- Overall: 3
- Notes: Surprisingly only 3 ingredients — MISSED yeast and salt entirely (both clearly mentioned on the source page). 14 steps with durations. servings=2, total_time=195. Tags populated. Format clean but the missing core ingredients is a real failure for a 5-ingredient recipe.

## Skipped URLs

- https://smittenkitchen.com/2018/03/dijon-and-cognac-beef-stew/ — fetch_failed
- https://www.seriouseats.com/the-food-lab-classic-pizza-margherita — fetch_failed
- https://www.allrecipes.com/recipe/16354/easy-meatloaf/ — fetch_failed
- https://www.epicurious.com/recipes/food/views/classic-tomato-soup-with-grilled-cheese-croutons — fetch_failed
