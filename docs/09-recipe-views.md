# 09 — Recipe Views

## Purpose

Specify the recipe-facing UI: list, detail, edit, scaling, unit toggle, and
language toggle. These are the most visited screens and they are where
Dishton's value lands. This doc names the routes, the data hooks, the URL
contract for sticky settings, and the component tree.

## Prerequisites

- [00-overview.md](./00-overview.md) — locked decisions.
- [03-design-system.md](./03-design-system.md) — primitives and tokens.
- [04-data-model.md](./04-data-model.md) — recipe tables and RLS.
- [05-auth-and-households.md](./05-auth-and-households.md) — route guards.
- [06-recipe-domain.md](./06-recipe-domain.md) — convert, scale, niceFraction.
- [08-import-pipelines.md](./08-import-pipelines.md) — draft flow and Save RPC.

## Routes

```
src/routes/(app)/h/$householdId/
  index.tsx             — recipe list (own household)
  r/$recipeId.tsx       — recipe detail
  r/$recipeId.edit.tsx  — recipe edit
  import/index.tsx      — owned by doc 08
src/routes/(app)/following/
  index.tsx             — recipes from followed households
  h/$followedId.tsx     — single followed household's list (read-only)
```

`requireHousehold` runs in `beforeLoad` for all `(app)/*` routes.

## URL contract for sticky settings

Detail and following-detail routes accept three search params, parsed via
TanStack Router's `validateSearch`:

```ts
// src/routes/(app)/h/$householdId/r/$recipeId.tsx (excerpt)
import { z } from 'zod';

const Search = z.object({
  scale: z.coerce.number().positive().optional(),
  servings: z.coerce.number().int().positive().optional(),
  units: z.enum(['metric','imperial']).optional(),
  lang: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).optional(),
}).refine(
  (s) => !(s.scale !== undefined && s.servings !== undefined),
  'use scale or servings, not both',
);
```

Resolution order:

1. URL params win.
2. Otherwise the user's profile preferences (`preferred_unit_system`,
   `preferred_language`).
3. Otherwise recipe defaults.

The detail page rewrites the URL on every change, debounced 200ms, via
`router.navigate({ to: '.', search: (prev) => ({ ...prev, ... }) })` so
copy-link gives a friend the exact view.

## Recipe list

Route: `/(app)/h/$householdId`.

Data:

```ts
// src/lib/queries/recipes.ts
export function useRecipeList(householdId: string) {
  return useQuery({
    queryKey: ['recipes', householdId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app.recipes')
        .select('id, title, description, hero_image_path, total_time_min, source_type, created_at, recipe_tags(tag)')
        .eq('household_id', householdId)
        .order('created_at', { ascending: false })
        .limit(60);
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });
}
```

Layout:

- Three-column responsive grid on `≥ 1024px`, two on `≥ 640px`, one column
  below.
- Each card uses asymmetric layout: 16:10 hero on the left (or top on mobile),
  ragged-right type on the right. Display font for the title.
- Empty state: large display-type heading "Your pantry is empty" + a primary
  action linking to `/import`.
- Stagger reveal on first paint (60ms × index up to 10 items, then snap).
- Filter bar at the top: search input (see
  [10-search-and-tags.md](./10-search-and-tags.md)) + tag chips.

Realtime: subscribe to `app.recipes` changes scoped to `household_id` via
`supabase.channel('h:'+id+':recipes')`. On INSERT/UPDATE/DELETE, invalidate
the list query.

## Recipe detail

Route: `/(app)/h/$householdId/r/$recipeId`.

Data:

```ts
const { recipe, ingredients, steps, tags } = useRecipe(recipeId);
```

`useRecipe` runs three parallel selects (recipe, recipe_ingredients,
recipe_steps + recipe_tags) and combines them. Realtime on the recipe row.

Layout:

```
┌──────────────────────────────────────────────────────────┐
│  Hero image (full-bleed on mobile,                       │
│  half-bleed asymmetric on desktop, with a 1px ink rule   │
│  dropping into the page)                                  │
├──────────────────────────────────────────────────────────┤
│   ── tags · source · time ──                              │
│                                                           │
│   Display title (Fraunces, opsz=72, soft=80)              │
│                                                           │
│   Description (body, leading-relaxed)                     │
├──────────────────────────────────────────────────────────┤
│ Sidebar (sticky, desktop):                                │
│ ┌────────────────────────┐                                │
│ │ Servings   [ 2 4 6 8 ] │   Steps (numbered, generous)   │
│ │ Scale      [ 1x      ] │                                │
│ │ Units      metric ▾    │   Step 1                       │
│ │ Language   en ▾        │   <body...>                    │
│ │                        │                                │
│ │ Ingredients            │   Step 2                       │
│ │ □ 200 g flour          │   <body...>                    │
│ │ □ 1 1/2 cup milk       │                                │
│ │ ...                    │                                │
│ └────────────────────────┘                                │
└──────────────────────────────────────────────────────────┘

Mobile: ingredient sidebar collapses into a Drawer at the bottom-edge,
opened by a sticky "Ingredients (12)" button.
```

Components:

- `<RecipeDetail>` (composer)
- `<RecipeHero>` (image, tags strip, title, description)
- `<RecipeSidebar>` — `<ServingsScaler>`, `<UnitToggle>`, `<LanguageToggle>`,
  `<IngredientList>`
- `<StepList>`
- `<EditButton>` — owners and editors only

Display pipeline:

```
recipe (canonical)
  → maybe replace text payload with cached translation
  → for each ingredient: convert(quantity, unit, displayUnit)
  → niceQuantity(displayValue, displayUnit) → formatFraction
  → render
```

All conversions happen in a memoised selector hook
`useDisplayedRecipe(recipe, displaySettings)` so re-rendering on slider drag
is cheap.

### Servings scaler

`<ServingsScaler>` exposes:

- a row of "snap" pills `[2, 4, 6, 8]` (the most common targets)
- a fine slider 0.25× - 4× the recipe's default servings
- a numeric input box

Internally: changing servings rewrites the URL with `?servings=N` (or `?scale=`
when the user uses the slider). Switching between modes does *not* try to
preserve the other; we round-trip via the recipe default.

### Unit toggle

Segmented control, two options: `metric | imperial`. Defaults from profile,
overridden by `?units=`. Click sets `?units=` and updates the URL. The toggle
lives in the sidebar and is mirrored as a small floating chip in the
fullscreen "cooking mode" overlay.

### Language toggle

`<LanguageToggle>` lists the user's `preferred_language`, the recipe's
`source_language`, and any languages already cached in `recipe_translations`.
Selecting an uncached language:

1. Computes `buildTranslationCacheKey(recipe, lang)`.
2. Posts to `/functions/v1/translate-recipe` with `{ recipe_id, lang }`.
3. Edge Function checks the cache row: if `source_hash` matches the live
   recipe and language matches, returns the cached payload. Otherwise calls
   Anthropic with the translation prompt (see
   [07-ai-integration.md](./07-ai-integration.md)), validates against
   Recipe, upserts `recipe_translations`, returns the payload.
4. SPA invalidates the recipe query and re-renders.

Loading state: skeleton replaces only the translatable fields (title,
description, ingredient names, step bodies); quantities and units stay
visible.

## Cooking mode

A button in the sidebar, "Start cooking", flips the page into a fullscreen
mode that:

- requests a Wake Lock via `navigator.wakeLock.request('screen')` (see
  [11-pwa-and-offline.md](./11-pwa-and-offline.md));
- enlarges body type by 1.25×;
- lays steps out one per viewport;
- ingredient checkboxes use the stamp animation;
- a small "Exit cooking" button releases the lock.

## Recipe edit

Route: `/(app)/h/$householdId/r/$recipeId/edit`.

- React-hook-form + Zod (`Recipe`).
- One screen with three sections (Meta, Ingredients, Steps) and a sticky
  Save bar.
- Drag-to-reorder ingredients and steps via `@dnd-kit/core` (lightweight, no
  Radix overlap). Only added if/when needed.
- Save calls `app.save_recipe` with the changed Recipe; for in-place edits we
  use a separate `app.update_recipe(p_id uuid, p_draft jsonb)` that performs
  the same expansion and clears the translation cache row(s) (since
  `source_hash` would change).

The edit form is reused by the import-draft flow (
[08-import-pipelines.md](./08-import-pipelines.md)) — that flow mounts the
same component without an existing `recipe_id`.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `s` | focus the search box (list page) |
| `i` | new import (list page) |
| `j` / `k` | next / previous recipe in list |
| `+` / `-` | scale up / down by 1 serving |
| `[` / `]` | switch units |
| `?` | help dialog showing all shortcuts |
| `Esc` | close any open Dialog/Drawer |

Shortcuts are off in inputs / textareas. Rendered help is generated from a
single `src/lib/shortcuts.ts` registry.

## Reduced motion

When `prefers-reduced-motion: reduce`:

- list reveal stagger collapses to instant render;
- ingredient stamp becomes a plain class change;
- page transitions are skipped;
- the slider does not animate intermediate values.

## Files this doc governs

- `/home/user/dishton/src/routes/(app)/h/$householdId/index.tsx`
- `/home/user/dishton/src/routes/(app)/h/$householdId/r/$recipeId.tsx`
- `/home/user/dishton/src/routes/(app)/h/$householdId/r/$recipeId.edit.tsx`
- `/home/user/dishton/src/routes/(app)/following/index.tsx`
- `/home/user/dishton/src/routes/(app)/following/h/$followedId.tsx`
- `/home/user/dishton/src/lib/queries/recipes.ts`
- `/home/user/dishton/src/lib/queries/translations.ts`
- `/home/user/dishton/src/lib/shortcuts.ts`
- `/home/user/dishton/src/ui/recipe/RecipeCard.tsx`
- `/home/user/dishton/src/ui/recipe/RecipeDetail.tsx`
- `/home/user/dishton/src/ui/recipe/RecipeHero.tsx`
- `/home/user/dishton/src/ui/recipe/RecipeSidebar.tsx`
- `/home/user/dishton/src/ui/recipe/IngredientList.tsx`
- `/home/user/dishton/src/ui/recipe/StepList.tsx`
- `/home/user/dishton/src/ui/recipe/ServingsScaler.tsx`
- `/home/user/dishton/src/ui/recipe/UnitToggle.tsx`
- `/home/user/dishton/src/ui/recipe/LanguageToggle.tsx`
- `/home/user/dishton/src/ui/recipe/RecipeEditForm.tsx`

## Acceptance criteria

- [ ] List page renders ≤ 60 cards, paginated/infinite-scrolled with cursor
      `created_at`. Empty and loading states implemented.
- [ ] Detail page resolves display unit + display language from URL with
      profile fallback, exactly as specified.
- [ ] Changing the slider rewrites the URL (`?scale=` or `?servings=`)
      without a full page navigation.
- [ ] `useDisplayedRecipe` is referentially stable across re-renders when
      inputs are unchanged (verified by a render-count test).
- [ ] Translation toggle hits the cache on the second request to the same
      language for the same recipe — no Anthropic call.
- [ ] Cooking-mode acquires Wake Lock and releases it on exit and on
      `visibilitychange`.
- [ ] All keyboard shortcuts work and are listed in the help dialog.
- [ ] `prefers-reduced-motion` is honoured everywhere on these screens.
- [ ] Editing a recipe invalidates `recipe_translations` for that recipe
      (the SPA also evicts its TanStack Query cache).
- [ ] No emojis anywhere in this doc or governed code.

## Verification

```bash
test -f docs/09-recipe-views.md
grep -q "## Purpose"                docs/09-recipe-views.md
grep -q "## Files this doc governs" docs/09-recipe-views.md
grep -q "## Acceptance criteria"    docs/09-recipe-views.md
grep -q "## Verification"           docs/09-recipe-views.md
! grep -P '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]' docs/09-recipe-views.md
for s in useRecipeList useDisplayedRecipe ServingsScaler UnitToggle \
         LanguageToggle "?units=" "?lang=" "?scale=" wakeLock; do
  grep -q "$s" docs/09-recipe-views.md || echo "missing: $s"
done
```

End-to-end:

```bash
pnpm test:components --filter=recipe
pnpm test:e2e --grep "scale and toggle"
```
