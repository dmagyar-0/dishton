# 10 — Search and Tags

## Purpose

Define how users find recipes. Search is server-side full-text in Postgres,
scoped to the user's accessible households (own + followed). Tags are
free-form short strings attached to a recipe; there is no global taxonomy.
The UI is a single `<SearchBar>` plus a row of `<Tag>` chips on the list page,
plus a tag picker on the recipe edit form.

## Prerequisites

- [04-data-model.md](./04-data-model.md) — `search` tsvector, FTS trigger,
  `app.recipe_tags`, `app.search_recipes` RPC.
- [09-recipe-views.md](./09-recipe-views.md) — list page integration.
- [03-design-system.md](./03-design-system.md) — `Input`, `Combobox`, `Tag`.

## Server side

The `app.recipes.search` column is a `tsvector` maintained by a `BEFORE INSERT
OR UPDATE` trigger and refreshed by `AFTER` triggers on
`recipe_ingredients` and `recipe_tags`. Weighting (defined in
[04-data-model.md](./04-data-model.md)):

| Weight | Source |
|---|---|
| A | `recipes.title` |
| B | concatenated `recipe_tags.tag` |
| C | concatenated `recipe_ingredients.ingredient_name` (falls back to `raw_text`) |

`websearch_to_tsquery('simple', q)` gives users quote-aware syntax
("tomato soup", `-cream`, etc.) for free. The `simple` config means no
language stemming — important because households mix languages and stemming
in the wrong language hurts recall. Recall is good enough with the weighted
weighting above.

Two RPCs are exposed (defined in [04-data-model.md](./04-data-model.md)):

```sql
app.search_recipes(q text, household_ids uuid[]) returns setof app.recipes
```

The SPA passes `household_ids = [own, ...followed]` so a single search covers
the whole accessible surface.

A second RPC, added here:

```sql
create or replace function app.popular_tags(p_household_ids uuid[], p_limit int default 24)
returns table(tag text, n bigint) language sql stable as $$
  select t.tag, count(*) as n
  from app.recipe_tags t
  join app.recipes r on r.id = t.recipe_id
  where r.household_id = any(p_household_ids)
  group by t.tag
  order by n desc, tag asc
  limit p_limit;
$$;
```

Used by the tag-chip strip on the list page.

## Client side

```ts
// src/lib/queries/search.ts
export function useRecipeSearch(q: string, householdIds: string[]) {
  return useQuery({
    queryKey: ['search', q, householdIds],
    enabled: q.trim().length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_recipes', {
        q, household_ids: householdIds,
      });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30_000,
  });
}

export function usePopularTags(householdIds: string[]) {
  return useQuery({
    queryKey: ['popular-tags', householdIds],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('popular_tags', {
        p_household_ids: householdIds, p_limit: 24,
      });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });
}
```

## Components

`src/ui/search/SearchBar.tsx`:

- `Input` with the bottom-border treatment from
  [03-design-system.md](./03-design-system.md).
- Debounce 200 ms before firing `useRecipeSearch` (debounce inside the
  component, not in the hook, so other call sites stay non-debounced).
- Loading state: a small ink-stroke spinner inside the input.
- Empty result: an `EmptyState` with the user's query echoed back and a
  "Clear search" button.
- Keyboard: `s` focuses the input (registered via `src/lib/shortcuts.ts`).

`src/ui/search/TagStrip.tsx`:

- Horizontally scrollable on mobile, wraps on desktop.
- Each `Tag` chip toggles a filter; multiple selected tags use AND semantics
  (intersection on the client because the FTS RPC returns the broad set).
- Active chip uses the `secondary` (sage) variant of the chip style.

`src/ui/recipe/TagPicker.tsx` (used in `RecipeEditForm`):

- `Combobox` allowing free typing or selection from `popular_tags`.
- Enter or comma submits the typed value.
- Lowercases everything; trims; rejects > 40 chars (hard limit per the DB).
- Shows the existing tag list as removable chips.

## List-page filter logic

Tag filters and the search query are both URL-backed:

```
/h/:id?q=<query>&tag=tomato&tag=soup
```

Resolution:

1. If `q.length >= 2`, use `useRecipeSearch` results.
2. Otherwise use `useRecipeList` results.
3. Apply `tag` filter on the client side (intersect tag arrays).

The URL is the source of truth; back/forward navigation restores the exact
filter state.

## Performance budget

- `search_recipes` p95 < 150 ms for ≤ 5 000 recipes per household and
  query string length ≤ 40 chars. Verified by a `pgbench` script in
  `supabase/perf/search.sql` that seeds 5 000 recipes and runs 200
  queries.
- The list page makes at most one round-trip per keystroke (after debounce).

## Files this doc governs

- `/home/user/dishton/src/lib/queries/search.ts`
- `/home/user/dishton/src/ui/search/SearchBar.tsx`
- `/home/user/dishton/src/ui/search/TagStrip.tsx`
- `/home/user/dishton/src/ui/recipe/TagPicker.tsx`
- `/home/user/dishton/supabase/perf/search.sql`
- A migration adding `app.popular_tags(uuid[], int)`.

## Acceptance criteria

- [ ] FTS finds recipes by title, by tag, and by ingredient name in the
      seeded fixtures.
- [ ] FTS does not find a recipe outside the user's accessible households
      (member or follower); RLS-asserted by `supabase/tests/rls.test.sql`.
- [ ] `popular_tags` returns at most `p_limit` rows ordered by descending
      count.
- [ ] `<SearchBar>` debounces input and shows the spinner only while a
      request is pending.
- [ ] Tag filters compose with AND semantics and round-trip via URL.
- [ ] `<TagPicker>` lowercases, trims, and rejects > 40 char inputs.
- [ ] No emojis anywhere in this doc or governed code.

## Verification

```bash
test -f docs/10-search-and-tags.md
grep -q "## Purpose"                docs/10-search-and-tags.md
grep -q "## Files this doc governs" docs/10-search-and-tags.md
grep -q "## Acceptance criteria"    docs/10-search-and-tags.md
grep -q "## Verification"           docs/10-search-and-tags.md
! grep -P '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]' docs/10-search-and-tags.md
for s in search_recipes popular_tags useRecipeSearch SearchBar TagStrip TagPicker \
         websearch_to_tsquery; do
  grep -q "$s" docs/10-search-and-tags.md || echo "missing: $s"
done
```

End-to-end:

```bash
pnpm test:db
pnpm test:components --filter=search
```
