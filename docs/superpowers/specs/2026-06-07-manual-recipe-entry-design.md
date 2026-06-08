# Manual recipe entry — design

**Date:** 2026-06-07
**Status:** Approved

## Problem

The import page (`/h/$householdId/import`, `src/routes/h/$householdId/import.tsx`)
has three tabs — URL, Photo, Manual. URL and Photo are implemented; the **Manual**
tab is a stub:

```tsx
function ManualTab() {
  return (
    <Card className="mt-4 p-6 text-ink-soft">
      Manual entry — full form lands in a follow-up PR.
    </Card>
  );
}
```

We need to let a user hand-type a structured recipe and save it — no AI, no Edge
Function. The repo already has everything required: a production-ready
`RecipeEditForm` (`src/ui/recipe/edit/RecipeEditForm.tsx`) that validates against
the frozen `Recipe` Zod contract (`src/domain/recipe.ts`), and the `save_recipe`
RPC that both other tabs use to persist a draft.

## Decision

- **Approach:** render the existing `RecipeEditForm` **inline in the Manual tab**
  with blank defaults and `source_type: 'manual'`. Persist via the same
  `save_recipe(p_household, p_draft)` RPC the URL/Photo tabs call, then navigate
  to the new recipe's detail page. (Chosen over a dedicated `/new` route or a
  free-text quick-add form.)
- **Targeted fix:** surface ingredient/step **row** validation errors, which are
  currently invisible. This is required for manual entry to be usable and also
  improves the edit flow.

## Design

### Data flow

```
Manual tab (import.tsx)
  └─ RecipeEditForm (reused, blank defaults, source_type:'manual')
       └─ onSubmit(recipe) ─► supabase.rpc('save_recipe', { p_household, p_draft })
            ├─ ok    ─► invalidate ['recipes', householdId] ─► success toast
            │           ─► navigate /h/$householdId/r/$newId
            └─ error ─► error toast (same detail pattern as URL/Photo tabs)
```

### `ManualTab({ householdId })` — `import.tsx`

- `ImportPage` passes `householdId` to `<ManualTab />` (currently passed nothing).
- Loads `useHouseholdAllowedTags(householdId)`; render the page's existing
  skeleton/`isLoading` treatment while tags load (mirror the edit page).
- Builds defaults via a new **pure** helper `blankManualRecipe(locale: string): Recipe`:
  - `source_type: 'manual'`, `servings: 4`, `canonical_unit_system: 'metric'`,
    `source_language: normaliseBcp47(locale) ?? 'en'`, `title: ''`,
    `description: null`, `source_url: null`, `total_time_min: null`,
    `hero_image_path: null`, `tags: []`.
  - **one empty ingredient row + one empty step row** (so structure is visible;
    user can delete either via the existing row trash button).
- Renders `RecipeEditForm` directly in the tab (no extra `Card` wrapper — the form
  brings its own section Cards), inside an `mt-4` div for spacing parity with the
  other tabs.
- `onSubmit(values)`:
  - `const { data: newId, error } = await supabase.rpc('save_recipe', { p_household: householdId, p_draft: values as never })`
  - on error → error toast reusing `import.error_title` + `errors.internal` +
    `import.error_detail_label` (same detail rendering as URL/Photo).
  - on success → `queryClient.invalidateQueries({ queryKey: ['recipes', householdId] })`,
    success toast (`import.success_title` / `import.success_body`), then
    `navigate({ to: '/h/$householdId/r/$recipeId', params: { householdId, recipeId: newId } })`.
- `onCancel` → `navigate({ to: '/h/$householdId', params: { householdId } })` (back
  to the recipe list).
- `submitLabel` = `import.manual_submit` ("Save recipe").

### Row validation errors (the silent-block fix)

Today an empty `raw_text` / `body` fails `zodResolver(Recipe)` but no error is
shown, so `handleSubmit` blocks the save with no visible reason. Fine for edit
(rows load filled), but it is the *default* state for manual entry. Additive,
backward-compatible change:

- `IngredientRowEditor` / `StepRowEditor` gain optional `error?: string`, rendered
  under the `raw_text` input / `body` textarea using the existing
  `text-pomegranate` error style.
- `RecipeEditForm`:
  - passes `errors` into its Ingredients/Steps sections; for row `idx` it feeds
    `errors.ingredients?.[idx]?.raw_text` → `t('recipe.ingredient_text_required')`
    and `errors.steps?.[idx]?.body` → `t('recipe.step_body_required')`.
  - gains optional `submitLabel?: string` (defaults to `t('recipe.edit_save')`),
    used for the submit button text.
- No behavior change for the edit page beyond *gaining* the row error messages it
  was previously missing.

### i18n (`src/lib/i18n.en.ts` + `src/lib/i18n.de.ts`)

New keys (en + de):

- `recipe.ingredient_text_required` — e.g. "Add a name or description for this ingredient."
- `recipe.step_body_required` — e.g. "Describe this step."
- `import.manual_submit` — "Save recipe".

Reuse existing `import.success_title` / `import.success_body` / `import.error_title`
/ `import.error_detail_label` / `errors.internal` and the form's
`recipe.edit_cancel`.

## Tests & docs

- **Unit:** `blankManualRecipe()` — returns a schema-valid blank with
  `source_type:'manual'`, one ingredient row, one step row, locale-derived
  `source_language`. Place beside the helper; `Recipe.parse` of a filled-in result
  succeeds.
- **Component:**
  - extend `RecipeEditForm.test.tsx` — empty `raw_text`/`body` on submit shows the
    row error message; `submitLabel` overrides the button text.
  - extend `IngredientRowEditor.test.tsx` / `StepRowEditor.test.tsx` — `error` prop
    renders.
  - manual-entry test (new, co-located): filling the Manual tab and submitting
    calls `save_recipe` with `source_type:'manual'` and navigates to the new
    recipe; mock `supabase.rpc` + router/navigation following existing patterns.
- No schema change → no migration. No new feature flag (always-on in the tab).

## Validation

Run the `validating-features-visually` skill before claiming done — Playwright
through signup → `/h/:householdId/import` → **Manual** tab → fill title /
servings / one ingredient / one step → Save → land on the recipe detail page, at
desktop and mobile viewports. Also glance at the recipe **edit** page (shared row
editors were touched) to confirm no regression.

## Implementation order

1. (TDD) `blankManualRecipe` test → red; implement → green.
2. (TDD) Row-error display: extend row-editor + `RecipeEditForm` tests → red; add
   `error` / `submitLabel` props → green; refactor.
3. Replace `ManualTab` stub; wire save → toast → navigate; pass `householdId` from
   `ImportPage`.
4. Add i18n keys (en + de).
5. Manual-entry component test.
6. `pnpm typecheck && pnpm lint`; run affected test files (changed files only on
   Windows — CI/LF is the lint source of truth).
7. Visual validation; then commit.

## Non-goals (YAGNI)

- No dedicated `/new` route.
- No unsaved-changes route blocker (matches the URL/Photo tabs).
- No free-text quick-add / line parsing.
- No hero-image upload.
