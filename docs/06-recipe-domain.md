# 06 — Recipe Domain

## Purpose

Define the canonical Recipe data shape, the unit graph and conversion rules,
the scaling algorithm with "nice fractions" rounding, the translation cache key,
and the pure-TypeScript module layout under `src/domain/`. This module is the
safety net for actual cooking — every quantity a user reads has been through
this code. It is pure (no React, no Supabase, no DOM) so it can be tested
exhaustively and imported from both the SPA and Edge Functions.

## Prerequisites

- [00-overview.md](./00-overview.md) — locked unit/language strategy.
- [04-data-model.md](./04-data-model.md) — DB columns shape the JSON.

## Module layout

```
/home/user/dishton/src/domain/
  recipe.ts            — Zod Recipe schema + types
  units/
    graph.ts           — dimensional categories + canonical units
    cooking.ts         — cup, tbsp, tsp, stick, pinch, dash, fl oz
    convert.ts         — convert(quantity, from, to)
    format.ts          — formatQuantity, formatUnit (per locale)
  scale.ts             — scale(recipe, factor) and scaleToServings
  fractions.ts         — niceFraction, snap, formatFraction
  language.ts          — locale fallback chain, BCP-47 normalisation
  translation-key.ts   — buildTranslationCacheKey
  index.ts             — barrel re-exports
```

No file in `src/domain/` may import from `src/lib/`, `src/ui/`, `src/routes/`,
or any package that touches the network or the DOM. CI grep enforces this.

## Recipe Zod schema

`src/domain/recipe.ts` is the single source of truth. Edge Functions import it
via the `_shared` symlink (see [07-ai-integration.md](./07-ai-integration.md)).

```ts
import { z } from 'zod';

// Quantity may be a decimal or a fraction for display fidelity.
export const Quantity = z.union([
  z.number().finite(),
  z.object({
    numerator: z.number().int().nonnegative(),
    denominator: z.number().int().positive(),
  }),
]);
export type Quantity = z.infer<typeof Quantity>;

export const UnitSystem = z.enum(['metric', 'imperial']);
export type UnitSystem = z.infer<typeof UnitSystem>;

export const Bcp47 = z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/);

// Free-text phrases like "to taste" or "pinch" stay as-is — never scaled.
export const NonScalableQty = z.enum([
  'to_taste', 'pinch', 'dash', 'splash', 'handful', 'optional',
]);

export const Ingredient = z.object({
  position: z.number().int().nonnegative(),
  raw_text: z.string().min(1),
  quantity: Quantity.nullable(),
  unit: z.string().nullable(),                 // canonical key from unit graph
  ingredient_name: z.string().nullable(),
  notes: z.string().nullable(),
  scalable: z.boolean().default(true),
  non_scalable_qty: NonScalableQty.nullable().default(null),
});
export type Ingredient = z.infer<typeof Ingredient>;

export const Step = z.object({
  position: z.number().int().nonnegative(),
  body: z.string().min(1),
  duration_min: z.number().int().nonnegative().nullable(),
});
export type Step = z.infer<typeof Step>;

export const RecipeMeta = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullable(),
  source_type: z.enum(['url','instagram','photo','manual']),
  source_url: z.string().url().nullable(),
  source_language: Bcp47.default('en'),
  canonical_unit_system: UnitSystem,
  servings: z.number().int().min(1).max(200),
  total_time_min: z.number().int().nonnegative().nullable(),
  hero_image_path: z.string().nullable(),
  tags: z.array(z.string().min(1).max(40)).default([]),
});
export type RecipeMeta = z.infer<typeof RecipeMeta>;

export const Recipe = RecipeMeta.extend({
  ingredients: z.array(Ingredient),
  steps: z.array(Step),
});
export type Recipe = z.infer<typeof Recipe>;
```

The "draft" returned by the Edge Functions is the same shape minus
`hero_image_path` (filled later) and minus `position` enforcement. Internally
positions are normalised by the SPA before persistence.

## Unit graph

`src/domain/units/graph.ts` defines dimensional categories and canonical units.

```ts
export type Dimension = 'mass' | 'volume' | 'count' | 'length' | 'temperature' | 'time';

export type UnitDef = {
  key: string;                      // canonical id, e.g. 'g', 'ml', 'cup_us'
  dimension: Dimension;
  toCanonical: number;              // multiplier to canonical unit of dimension
  symbol: { en: string; de?: string; fr?: string; it?: string; es?: string };
  system: UnitSystem | 'both';
};

export const CANONICAL: Record<Dimension, string> = {
  mass: 'g', volume: 'ml', count: 'count', length: 'mm',
  temperature: 'C', time: 'min',
};
```

The initial table (excerpt — full table lives in source):

| key | dimension | toCanonical | symbol.en | system |
|---|---|---|---|---|
| g | mass | 1 | g | both |
| kg | mass | 1000 | kg | both |
| oz | mass | 28.3495 | oz | imperial |
| lb | mass | 453.592 | lb | imperial |
| ml | volume | 1 | ml | both |
| l | volume | 1000 | l | both |
| tsp | volume | 5 | tsp | both |
| tbsp | volume | 15 | tbsp | both |
| cup_us | volume | 240 | cup | imperial |
| cup_metric | volume | 250 | cup | metric |
| fl_oz | volume | 29.5735 | fl oz | imperial |
| pint_us | volume | 473.176 | pt | imperial |
| count | count | 1 | × | both |
| C | temperature | 1 | °C | metric |
| F | temperature | (lambda — see below) | °F | imperial |
| min | time | 1 | min | both |
| h | time | 60 | h | both |

**Cup ambiguity is resolved**: parser default for "cup" is `cup_us` (240 ml).
European recipe sources (`source_language` of `de|fr|it|es|sv|no|fi|...`) parse
"cup" / "tasse" / "kop" as `cup_metric` (250 ml). The parser's choice is
recorded in the ingredient row; conversion at view time uses whichever is
stored.

Temperature is the only non-multiplicative unit and is handled by a special
case in `convert`:

```ts
// src/domain/units/convert.ts (excerpt)
export function convert(
  qty: number,
  from: string,
  to: string,
  graph: typeof units = units,
): number {
  if (from === to) return qty;
  const a = graph[from]; const b = graph[to];
  if (!a || !b) throw new Error(`unknown unit: ${from} or ${to}`);
  if (a.dimension !== b.dimension) {
    throw new Error(`incompatible: ${from} (${a.dimension}) -> ${to} (${b.dimension})`);
  }
  if (a.dimension === 'temperature') {
    if (from === 'C' && to === 'F') return qty * 9 / 5 + 32;
    if (from === 'F' && to === 'C') return (qty - 32) * 5 / 9;
    return qty;
  }
  return qty * a.toCanonical / b.toCanonical;
}
```

`convert-units` (the npm package) is used as a fallback for length and any
non-cooking dimensions; cooking-specific entries override it.

### Choosing a display unit

Given an ingredient with `unit = X` and a profile preference of
`metric` or `imperial`, the SPA picks a target unit by:

1. Look up `X.dimension`.
2. Filter the unit table to `system in ['both', preferredSystem]`.
3. Choose the first unit whose `toCanonical` is closest to the ingredient's
   canonical value without overshooting "too small" (< 0.1) or "too large"
   (> 999). For mass: prefer `g` < 1000, else `kg`. For volume: prefer `ml`
   < 1000, else `l`; if user prefers imperial and ml is < 240, prefer
   `tbsp`/`tsp`; for ml between 240 and 1000, prefer `cup_us`. Tests assert
   each branch.

## Scaling

`scale(recipe, factor: number)` returns a new Recipe with each ingredient's
`quantity` multiplied by `factor`. Steps are scanned for embedded quantity
spans (e.g. "Bake at 180°C for 25 minutes") — the body is left unchanged
because user studies show people prefer canonical step text; quantities are
shown in the ingredient list. (v1 may revisit this — see
[15-roadmap-and-flags.md](./15-roadmap-and-flags.md).)

```ts
// src/domain/scale.ts
export function scale(recipe: Recipe, factor: number): Recipe {
  if (!isFinite(factor) || factor <= 0) {
    throw new Error('scale factor must be positive and finite');
  }
  return {
    ...recipe,
    servings: Math.max(1, Math.round(recipe.servings * factor)),
    ingredients: recipe.ingredients.map((ing) => {
      if (!ing.scalable || ing.quantity == null) return ing;
      const q = quantityToNumber(ing.quantity) * factor;
      return { ...ing, quantity: niceQuantity(q, ing.unit) };
    }),
  };
}

export function scaleToServings(recipe: Recipe, target: number): Recipe {
  return scale(recipe, target / recipe.servings);
}
```

### "Nice fraction" rounding

`niceQuantity(value, unit)` snaps the multiplied value to a sensible display
value. Rules:

| Domain | Rule |
|---|---|
| Volume in `tsp`, `tbsp`, `cup_*` | Snap to nearest 1/8. Render as mixed number (e.g. `1 1/4 cup`). |
| Volume in `ml` | < 100 ml: nearest 5 ml. 100-1000 ml: nearest 25 ml. ≥ 1000 ml: render in litres (`1.25 l`), nearest 0.05 l. |
| Volume in `l` | Nearest 0.05 l. |
| Mass in `g` | < 100 g: nearest 5 g. 100-1000 g: nearest 25 g. ≥ 1000 g: render in kg, nearest 0.05 kg. |
| Mass in `oz`, `lb` | Snap to nearest 1/8. |
| Count | Round to integer when ≥ 1; below 1 keep one decimal ("0.5 lemon"). |
| Time | Round to nearest 5 min for ≥ 5 min, otherwise nearest minute. |
| Temperature | Round to nearest 5 °C / nearest 5 °F. |

Implemented in `src/domain/fractions.ts`:

```ts
export function snap(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export function niceFraction(value: number, denom: 8 | 4 | 2): {
  whole: number; numerator: number; denominator: number;
} {
  const total = Math.round(value * denom);
  const whole = Math.floor(total / denom);
  const num = total - whole * denom;
  if (num === 0) return { whole, numerator: 0, denominator: denom };
  // reduce 4/8 → 1/2, 2/8 → 1/4
  const g = gcd(num, denom);
  return { whole, numerator: num / g, denominator: denom / g };
}

export function formatFraction(f: ReturnType<typeof niceFraction>): string {
  if (f.numerator === 0) return String(f.whole);
  if (f.whole === 0) return `${f.numerator}/${f.denominator}`;
  return `${f.whole} ${f.numerator}/${f.denominator}`;
}
```

### Invariants (enforced by `fast-check` property tests)

For all positive `factor`, integer `n ≥ 1`, and any `recipe`:

- `scale(scale(recipe, factor), 1/factor)` ≈ `recipe` per ingredient (within
  rounding tolerance equal to the unit's snap step).
- `scale(recipe, 1)` is structurally equal to `recipe`.
- `convert(qty, A, A) === qty` for every unit `A`.
- `convert(convert(qty, A, B), B, A)` ≈ `qty` (within 1e-9 absolute).
- For each unit, `convert(0, A, B) === 0` (or 32 for °F target), and the
  conversion is monotonic.

## Translation cache key

Each cached translation is keyed by `(recipe_id, language)` in
`app.recipe_translations`. The cache stores the translated payload plus a
`source_hash` so we can invalidate after a recipe edit:

```ts
import { sha256 } from '@noble/hashes/sha256';   // tiny, no Node crypto

export function buildTranslationCacheKey(
  recipe: Recipe,
  targetLanguage: string,
): { sourceHash: string; key: string } {
  const canonicalJson = stableStringify(recipe);  // stable key order
  const hashBytes = sha256(new TextEncoder().encode(canonicalJson));
  const sourceHash = bytesToHex(hashBytes);
  return { sourceHash, key: `${sourceHash}:${targetLanguage}` };
}
```

When a translation is requested, the SPA reads
`recipe_translations.source_hash`. If it differs from the freshly computed
hash, the cache row is stale; the Edge Function recomputes and overwrites.

`stableStringify` is a 30-line helper that sorts object keys recursively — it
must produce identical output for semantically equal inputs (added in
`src/domain/translation-key.ts`).

## Locale + language

`src/domain/language.ts` normalises BCP-47 strings and resolves a fallback
chain when a translation row is missing:

```
'fr-CA' → ['fr-CA', 'fr', 'en']
'pt-BR' → ['pt-BR', 'pt', 'en']
```

The user's `preferred_language` is normalised on read; only `xx` or `xx-YY`
forms are accepted (matches the DB CHECK).

## Files this doc governs

- `/home/user/dishton/src/domain/recipe.ts`
- `/home/user/dishton/src/domain/units/graph.ts`
- `/home/user/dishton/src/domain/units/cooking.ts`
- `/home/user/dishton/src/domain/units/convert.ts`
- `/home/user/dishton/src/domain/units/format.ts`
- `/home/user/dishton/src/domain/scale.ts`
- `/home/user/dishton/src/domain/fractions.ts`
- `/home/user/dishton/src/domain/language.ts`
- `/home/user/dishton/src/domain/translation-key.ts`
- `/home/user/dishton/src/domain/index.ts`

## Acceptance criteria

- [ ] `Recipe.parse(jsonFromAI)` accepts every fixture in
      `e2e/fixtures/ai-draft.*.json`.
- [ ] `convert` is correct on a hand-written truth table covering at minimum
      g↔kg, g↔oz↔lb, ml↔l, ml↔tsp↔tbsp↔cup_us↔fl_oz, °C↔°F.
- [ ] `scale(recipe, 1)` is deep-equal to `recipe`.
- [ ] `scale(scale(r, k), 1/k)` is per-ingredient equal to `r` within the unit's
      snap step.
- [ ] `niceFraction(0.625, 8)` returns `{whole:0, numerator:5, denominator:8}`
      and `formatFraction(...)` prints `5/8`.
- [ ] Property tests run via `fast-check` with `numRuns: 200` and pass on CI.
- [ ] No file under `src/domain/` imports React, Supabase, or any DOM API.
- [ ] `pnpm test:coverage` reports ≥ 90% line and branch coverage on
      `src/domain/**`.

## Verification

```bash
test -f docs/06-recipe-domain.md
grep -q "## Purpose"                docs/06-recipe-domain.md
grep -q "## Files this doc governs" docs/06-recipe-domain.md
grep -q "## Acceptance criteria"    docs/06-recipe-domain.md
grep -q "## Verification"           docs/06-recipe-domain.md
! grep -P '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]' docs/06-recipe-domain.md
for s in Recipe.parse niceFraction scaleToServings buildTranslationCacheKey \
         CANONICAL convert; do
  grep -q "$s" docs/06-recipe-domain.md || echo "missing symbol: $s"
done
```

After implementation:

```bash
pnpm test:unit --project domain
pnpm test:coverage
```
