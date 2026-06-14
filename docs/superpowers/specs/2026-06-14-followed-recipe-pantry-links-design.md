# Save followed recipes to your pantry (live links)

**Date:** 2026-06-14
**Status:** Approved, implemented on `claude/followed-recipe-pantry-links-84hxg1`

## Problem

A user who follows another household can browse that household's recipes (via
`/following` → "Open" → `/h/$followedId`) but cannot keep any of them in their
own collection. They want to add a followed household's recipe to **their own
pantry** as a **live link** — not a copy — so that when the original is edited,
the saved version always reflects the latest. Every such followed recipe should
carry a visible marker on the home page.

## Approach

A new `app.recipe_links` table stores a reference from a saving ("pantry")
household to a recipe owned by a household it follows. Reads resolve the current
original, so source edits show through automatically. The home page merges these
links with the household's own recipes and badges them.

This is gated behind the existing `follows_enabled` runtime flag — links are
meaningless without the follow system.

## Data model — `app.recipe_links`

| column        | type        | notes                                       |
|---------------|-------------|---------------------------------------------|
| household_id  | uuid        | the saving pantry; FK households, cascade   |
| recipe_id     | uuid        | the original; FK recipes, cascade           |
| created_by    | uuid        | FK profiles                                 |
| created_at    | timestamptz | save time; used as the pantry sort key      |

Primary key `(household_id, recipe_id)`. `on delete cascade` on `recipe_id`
means a deleted original (or an original whose household is deleted) removes the
link automatically.

Migration: `supabase/migrations/20260614130000_recipe_links.sql`.

## RLS

Mirrors the existing `app.is_*` SECURITY DEFINER helpers (no recursion).

- **Read:** members or followers of `household_id`. The home query inner-joins
  to `recipes`, so a link whose original isn't visible to the reader drops out.
- **Insert:** `created_by = auth.uid()` AND `is_household_editor(household_id)`
  AND `is_recipe_visible(recipe_id)` (i.e. the recipe lives in a household you
  follow) AND NOT `is_recipe_in_household(recipe_id, household_id)` (no
  self-links). `is_recipe_in_household` is a new SECURITY DEFINER helper.
- **Delete:** editors of `household_id`. No UPDATE policy.

## Data layer — `src/lib/queries/recipe-links.ts`

- `usePantryHouseholdId()` — the personal household (fallback first membership),
  matching `/following`'s save target.
- `useRecipeLinks(householdId, enabled)` — joins `recipes!inner(...)` and
  flattens each row to a `RecipeListRow & { is_link: true }`, using the link's
  `created_at` as the sort key.
- `useLinkedRecipeIds(householdId, enabled)` — `Set<recipe_id>` for showing the
  "saved" state on a followed household's cards without per-card queries.
- `useSaveRecipeLink` / `useRemoveRecipeLink` — mutations; remove uses
  `.select()` so an RLS no-op surfaces as an error, not a false success.

`RecipeListRow` gains an optional `is_link?: boolean` so the home grid stays a
homogeneous list.

## UI

- **Home page** (`/h/$householdId`, member view): own recipes + saved links
  merged newest-first. Linked cards get a top-left `Link2` badge
  (`RecipeLinkBadge`) and a top-right remove-from-pantry button with a confirm
  (`RecipeCardRemoveLinkButton`). Cards link to the original via `r.household_id`
  (already the source household). Tag filtering covers links (client-side).
- **Followed-household browse** (same route, follower view — not a member): each
  card shows a save/remove toggle (`RecipeCardSaveButton`) that writes into the
  viewer's pantry household.
- **Recipe detail page**: when viewing a followed recipe, a labeled save/remove
  toggle (`RecipeDetailSaveButton`) sits in the title-row action cluster.

## Out of scope (v1)

Full-text **search** over linked recipes. Tag filtering works on the merged
list, but typing a query searches only the household's own recipes. Documented
as a follow-up.

## Tests

- `supabase/tests/recipe_links.test.sql` — RLS: follower can link a followed
  recipe; non-follower and own-recipe (self-link) rejected; can't link into a
  household you don't edit; member reads, unrelated doesn't; cascade on original
  delete; editor can remove, unrelated can't.
- `src/lib/queries/recipe-links.test.tsx` — insert payload, remove scoping +
  RLS-no-op detection, join-row flattening, pantry household selection.
- Visual validation per CLAUDE.md.
