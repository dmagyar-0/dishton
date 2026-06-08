# Manual Recipe Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stubbed Manual tab on `/h/$householdId/import` with a working form that lets a user hand-type a structured recipe and save it.

**Architecture:** Reuse the existing `RecipeEditForm` inline in the Manual tab with blank defaults (`source_type: 'manual'`). Persist through the same `save_recipe(p_household, p_draft)` RPC the URL/Photo tabs use, then navigate to the new recipe's detail page. A small additive change surfaces ingredient/step row validation errors (currently invisible) so empty rows don't block save silently.

**Tech Stack:** React + Vite, react-hook-form + `zodResolver(Recipe)`, TanStack Router + Query, Supabase RPC, Vitest + Testing Library, i18n (en/de), Biome.

> **Repo policy note:** the harness commits only when the user asks. Treat the "Commit" steps as logical checkpoints — run the `git` commands only after the user approves committing (or batch them at the end).

> **Windows note (per memory):** `pnpm lint` shows false whole-repo failures on Windows (CRLF). Validate changed files only; CI (LF) is the source of truth.

---

## File Structure

- **Create** `src/lib/forms/manual-recipe.ts` — pure `blankManualRecipe(locale)` factory (no React, no I/O). Lives beside the other `src/lib/forms/*` helpers.
- **Create** `src/lib/forms/manual-recipe.test.ts` — unit test for the factory.
- **Modify** `src/ui/recipe/edit/StepRowEditor.tsx` — add optional `error?: string` prop + display.
- **Modify** `src/ui/recipe/edit/StepRowEditor.test.tsx` — assert the error renders.
- **Modify** `src/ui/recipe/edit/IngredientRowEditor.tsx` — add optional `error?: string` prop + display.
- **Modify** `src/ui/recipe/edit/IngredientRowEditor.test.tsx` — assert the error renders.
- **Modify** `src/ui/recipe/edit/RecipeEditForm.tsx` — feed row errors into the sections; add optional `submitLabel` prop.
- **Modify** `src/ui/recipe/edit/RecipeEditForm.test.tsx` — assert row errors surface on submit + `submitLabel` works.
- **Modify** `src/lib/i18n.en.ts` / `src/lib/i18n.de.ts` — 3 new keys each.
- **Modify** `src/routes/h/$householdId/import.tsx` — real `ManualTab({ householdId })` + pass `householdId` from `ImportPage`.

---

## Task 1: `blankManualRecipe` factory

**Files:**
- Create: `src/lib/forms/manual-recipe.ts`
- Test: `src/lib/forms/manual-recipe.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/forms/manual-recipe.test.ts
import { Recipe } from '@/domain/recipe';
import { describe, expect, it } from 'vitest';
import { blankManualRecipe } from './manual-recipe';

describe('blankManualRecipe', () => {
  it('produces a manual-source blank with one ingredient and one step', () => {
    const r = blankManualRecipe('en');
    expect(r.source_type).toBe('manual');
    expect(r.title).toBe('');
    expect(r.servings).toBe(4);
    expect(r.canonical_unit_system).toBe('metric');
    expect(r.ingredients).toHaveLength(1);
    expect(r.ingredients[0]?.raw_text).toBe('');
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0]?.body).toBe('');
  });

  it('derives source_language from the locale and falls back to en', () => {
    expect(blankManualRecipe('de').source_language).toBe('de');
    expect(blankManualRecipe('').source_language).toBe('en');
  });

  it('parses against the Recipe schema once title and rows are filled', () => {
    const base = blankManualRecipe('en');
    const filled = {
      ...base,
      title: 'Test recipe',
      ingredients: base.ingredients.map((i) => ({ ...i, raw_text: '2 eggs' })),
      steps: base.steps.map((s) => ({ ...s, body: 'Mix everything.' })),
    };
    expect(() => Recipe.parse(filled)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/forms/manual-recipe.test.ts`
Expected: FAIL — cannot resolve `./manual-recipe` / `blankManualRecipe is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/forms/manual-recipe.ts
import { normaliseBcp47 } from '@/domain';
import type { Ingredient, Recipe, Step } from '@/domain/recipe';

function blankIngredient(position: number): Ingredient {
  return {
    position,
    raw_text: '',
    quantity: null,
    unit: null,
    ingredient_name: null,
    notes: null,
    scalable: true,
    non_scalable_qty: null,
    section: null,
  };
}

function blankStep(position: number): Step {
  return { position, body: '', duration_min: null };
}

// A schema-shaped blank recipe for hand entry. `source_type` is fixed to
// 'manual'; `source_language` is derived from the active UI locale (normalised
// to the DB-accepted BCP-47 form, falling back to 'en'). Seeds one empty
// ingredient and one empty step so the structure is visible — the user can
// delete either row.
export function blankManualRecipe(locale: string): Recipe {
  return {
    title: '',
    description: null,
    source_type: 'manual',
    source_url: null,
    source_language: normaliseBcp47(locale) ?? 'en',
    canonical_unit_system: 'metric',
    servings: 4,
    total_time_min: null,
    hero_image_path: null,
    tags: [],
    ingredients: [blankIngredient(0)],
    steps: [blankStep(0)],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/forms/manual-recipe.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit** (per repo policy — only when approved)

```bash
git add src/lib/forms/manual-recipe.ts src/lib/forms/manual-recipe.test.ts
git commit -m "feat(recipe): add blankManualRecipe factory for manual entry"
```

---

## Task 2: i18n keys (en + de)

**Files:**
- Modify: `src/lib/i18n.en.ts` (recipe block ends ~line 380; import block starts ~line 381)
- Modify: `src/lib/i18n.de.ts` (recipe block ends ~line 392; import block starts ~line 393)

Done early so later `t('recipe.ingredient_text_required')` / `t('import.manual_submit')` calls typecheck (resources are typed off `en`).

- [ ] **Step 1: Add the two recipe keys to `i18n.en.ts`**

In the `recipe:` object, immediately after the `quantity_invalid: '...'` line, add:

```ts
    ingredient_text_required: 'Add a name or description for this ingredient.',
    step_body_required: 'Describe this step.',
```

- [ ] **Step 2: Add the import key to `i18n.en.ts`**

In the `import:` object, immediately after `tab_manual: 'Manual',`, add:

```ts
    manual_submit: 'Save recipe',
```

- [ ] **Step 3: Add the matching keys to `i18n.de.ts`**

In the `recipe:` object, after `quantity_invalid: '...'`, add:

```ts
    ingredient_text_required: 'Gib einen Namen oder eine Beschreibung für diese Zutat ein.',
    step_body_required: 'Beschreibe diesen Schritt.',
```

In the `import:` object, after `tab_manual: 'Manuell',`, add:

```ts
    manual_submit: 'Rezept speichern',
```

- [ ] **Step 4: Verify typecheck still passes**

Run: `pnpm typecheck`
Expected: PASS (en/de resource shapes stay in sync).

- [ ] **Step 5: Commit** (when approved)

```bash
git add src/lib/i18n.en.ts src/lib/i18n.de.ts
git commit -m "i18n: add manual-entry strings (en/de)"
```

---

## Task 3: Row-error display in row editors

**Files:**
- Modify: `src/ui/recipe/edit/StepRowEditor.tsx`
- Modify: `src/ui/recipe/edit/StepRowEditor.test.tsx`
- Modify: `src/ui/recipe/edit/IngredientRowEditor.tsx`
- Modify: `src/ui/recipe/edit/IngredientRowEditor.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `StepRowEditor.test.tsx`, extend `renderRow` to accept `error` and add a test:

```ts
  // add `error?: string` to the opts type and pass it on the component:
  function renderRow(
    opts: { isFirst?: boolean; isLast?: boolean; value?: StepRowValue; error?: string } = {},
  ) {
    return render(
      <ul>
        <StepRowEditor
          index={0}
          value={opts.value ?? baseValue()}
          isFirst={opts.isFirst ?? false}
          isLast={opts.isLast ?? false}
          onChange={onChange}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
          onRemove={onRemove}
          error={opts.error}
        />
      </ul>,
    );
  }

  it('renders the error message when provided', () => {
    renderRow({ error: 'recipe.step_body_required' });
    expect(screen.getByText('recipe.step_body_required')).toBeInTheDocument();
  });
```

In `IngredientRowEditor.test.tsx`, extend `renderRow` similarly and add:

```ts
  function renderRow(
    opts: { isFirst?: boolean; isLast?: boolean; value?: IngredientRowValue; error?: string } = {},
  ) {
    return render(
      <ul>
        <IngredientRowEditor
          index={0}
          value={opts.value ?? baseValue()}
          isFirst={opts.isFirst ?? false}
          isLast={opts.isLast ?? false}
          onChange={onChange}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
          onRemove={onRemove}
          error={opts.error}
        />
      </ul>,
    );
  }

  it('renders the error message when provided', () => {
    renderRow({ error: 'recipe.ingredient_text_required' });
    expect(screen.getByText('recipe.ingredient_text_required')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/ui/recipe/edit/StepRowEditor.test.tsx src/ui/recipe/edit/IngredientRowEditor.test.tsx`
Expected: FAIL — `error` is not a valid prop / message not found (TS error or assertion failure).

- [ ] **Step 3: Add the prop + display to `StepRowEditor.tsx`**

Add `error?: string;` to the `Props` type:

```ts
type Props = {
  index: number;
  value: StepRowValue;
  isFirst: boolean;
  isLast: boolean;
  onChange: (patch: Partial<StepRowValue>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  error?: string;
};
```

Destructure `error` in the component signature, then render it under the body. Add this block immediately **after** the `<div className="flex items-start gap-3">…</div>` that wraps the textarea + move buttons (i.e. before the `ml-11` duration row):

```tsx
      {error && (
        <p className="ml-11 text-xs text-pomegranate" role="alert">
          {error}
        </p>
      )}
```

- [ ] **Step 4: Add the prop + display to `IngredientRowEditor.tsx`**

Add `error?: string;` to its `Props` type and destructure `error`. Render it at the **end** of the `<li>`, after the `<div className="ml-10 flex items-center justify-between gap-2">…</div>` that holds the `raw_text` input + trash button:

```tsx
      {error && (
        <p className="ml-10 text-xs text-pomegranate" role="alert">
          {error}
        </p>
      )}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/ui/recipe/edit/StepRowEditor.test.tsx src/ui/recipe/edit/IngredientRowEditor.test.tsx`
Expected: PASS (existing tests + the two new ones).

- [ ] **Step 6: Commit** (when approved)

```bash
git add src/ui/recipe/edit/StepRowEditor.tsx src/ui/recipe/edit/StepRowEditor.test.tsx src/ui/recipe/edit/IngredientRowEditor.tsx src/ui/recipe/edit/IngredientRowEditor.test.tsx
git commit -m "feat(recipe): surface row validation errors in ingredient/step editors"
```

---

## Task 4: Wire row errors + `submitLabel` into `RecipeEditForm`

**Files:**
- Modify: `src/ui/recipe/edit/RecipeEditForm.tsx`
- Modify: `src/ui/recipe/edit/RecipeEditForm.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `RecipeEditForm.test.tsx` (uses the existing `sampleRecipe()` / `ALLOWED`):

```ts
  it('surfaces a row error and blocks submit when a step body is emptied', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <RecipeEditForm
        defaultValues={sampleRecipe()}
        allowedTags={ALLOWED}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    await user.clear(screen.getByDisplayValue('Preheat oven.'));
    await user.click(screen.getByRole('button', { name: 'recipe.edit_save' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('recipe.step_body_required')).toBeInTheDocument();
  });

  it('surfaces a row error and blocks submit when an ingredient line is emptied', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <RecipeEditForm
        defaultValues={sampleRecipe()}
        allowedTags={ALLOWED}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    await user.clear(screen.getByDisplayValue('500 g tomatoes'));
    await user.click(screen.getByRole('button', { name: 'recipe.edit_save' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('recipe.ingredient_text_required')).toBeInTheDocument();
  });

  it('uses a custom submit label when provided', () => {
    render(
      <RecipeEditForm
        defaultValues={sampleRecipe()}
        allowedTags={ALLOWED}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        submitLabel="import.manual_submit"
      />,
    );
    expect(screen.getByRole('button', { name: 'import.manual_submit' })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/ui/recipe/edit/RecipeEditForm.test.tsx`
Expected: FAIL — `submitLabel` not a prop; row error text not found (errors not passed to rows yet).

- [ ] **Step 3: Add `submitLabel` to props + button**

In `RecipeEditFormProps` add `submitLabel?: string;`. Destructure it in the component. Change the submit button text:

```tsx
        <Button type="submit" loading={isSubmitting} disabled={isSubmitting}>
          {submitLabel ?? t('recipe.edit_save')}
        </Button>
```

- [ ] **Step 4: Pass `errors` into the sections**

Update the two section calls in the form body:

```tsx
      <IngredientsSection control={control} errors={errors} />
      <StepsSection control={control} errors={errors} />
```

- [ ] **Step 5: Consume `errors` in `IngredientsSection`**

Change its signature and pass a per-row `error` (reuse the existing `Errors` type alias):

```tsx
function IngredientsSection({ control, errors }: { control: Control<Recipe>; errors: Errors }) {
  const { t } = useTranslation();
  const { fields, append, remove, move } = useFieldArray({ control, name: 'ingredients' });
```

Then in the `IngredientRowEditor` render, add:

```tsx
              error={errors.ingredients?.[idx]?.raw_text ? t('recipe.ingredient_text_required') : undefined}
```

- [ ] **Step 6: Consume `errors` in `StepsSection`**

```tsx
function StepsSection({ control, errors }: { control: Control<Recipe>; errors: Errors }) {
  const { t } = useTranslation();
  const { fields, append, remove, move } = useFieldArray({ control, name: 'steps' });
```

Then in the `StepRowEditor` render, add:

```tsx
              error={errors.steps?.[idx]?.body ? t('recipe.step_body_required') : undefined}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm vitest run src/ui/recipe/edit/RecipeEditForm.test.tsx`
Expected: PASS (existing 4 + 3 new).

- [ ] **Step 8: Commit** (when approved)

```bash
git add src/ui/recipe/edit/RecipeEditForm.tsx src/ui/recipe/edit/RecipeEditForm.test.tsx
git commit -m "feat(recipe): wire row errors and submitLabel through RecipeEditForm"
```

---

## Task 5: Implement the Manual tab

**Files:**
- Modify: `src/routes/h/$householdId/import.tsx` (replace `ManualTab` at ~line 603; update `ImportPage` at ~line 114)

No co-located unit test (the URL/Photo tabs have none; the save→navigate path is covered by the required visual validation in Task 7, consistent with the repo's approach to this route).

- [ ] **Step 1: Add imports**

At the top of `import.tsx`, add:

```ts
import type { Recipe } from '@/domain/recipe';
import { blankManualRecipe } from '@/lib/forms/manual-recipe';
import { useHouseholdAllowedTags } from '@/lib/queries/households';
import { Skeleton } from '@/ui/primitives/Skeleton';
import { RecipeEditForm } from '@/ui/recipe/edit/RecipeEditForm';
```

And add `useMemo` to the existing React import:

```ts
import { useMemo, useRef, useState } from 'react';
```

- [ ] **Step 2: Pass `householdId` to `ManualTab` in `ImportPage`**

```tsx
        <TabsContent value="manual">
          <ManualTab householdId={householdId} />
        </TabsContent>
```

- [ ] **Step 3: Replace the `ManualTab` stub**

```tsx
function ManualTab({ householdId }: { householdId: string }) {
  const { t, i18n } = useTranslation();
  const { push } = useToast();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const { tags: allowedTags, isLoading: tagsLoading } = useHouseholdAllowedTags(householdId);
  const [isSaving, setIsSaving] = useState(false);
  const defaults = useMemo(() => blankManualRecipe(i18n.language), [i18n.language]);

  const handleSubmit = async (values: Recipe): Promise<void> => {
    setIsSaving(true);
    const { data: newId, error: saveErr } = await supabase.rpc('save_recipe', {
      p_household: householdId,
      p_draft: values as never,
    });
    if (saveErr || !newId) {
      setIsSaving(false);
      const detail = saveErr?.message?.trim() || saveErr?.details?.trim() || null;
      push({
        variant: 'error',
        persist: detail !== null,
        title: t('import.error_title'),
        description: (
          <>
            <p>{t('errors.internal')}</p>
            {detail && (
              <p className="mt-1 text-xs opacity-80 break-words">
                <span className="font-medium">{t('import.error_detail_label')}:</span> {detail}
              </p>
            )}
          </>
        ),
      });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['recipes', householdId] });
    push({
      variant: 'success',
      title: t('import.success_title'),
      description: t('import.success_body'),
    });
    await navigate({
      to: '/h/$householdId/r/$recipeId',
      params: { householdId, recipeId: newId },
    });
  };

  if (tagsLoading) {
    return (
      <div className="mt-4 space-y-4">
        <Skeleton className="h-40" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="mt-4">
      <RecipeEditForm
        defaultValues={defaults}
        allowedTags={allowedTags}
        onSubmit={handleSubmit}
        onCancel={() => navigate({ to: '/h/$householdId', params: { householdId } })}
        isSubmitting={isSaving}
        submitLabel={t('import.manual_submit')}
      />
    </div>
  );
}
```

- [ ] **Step 4: Verify it builds/typechecks**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit** (when approved)

```bash
git add src/routes/h/$householdId/import.tsx
git commit -m "feat(import): implement manual recipe entry tab"
```

---

## Task 6: Static checks + affected tests

- [ ] **Step 1: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 2: Lint the changed files only** (Windows-safe; CI/LF is authoritative)

Run: `pnpm biome check src/lib/forms/manual-recipe.ts src/lib/forms/manual-recipe.test.ts src/ui/recipe/edit/RecipeEditForm.tsx src/ui/recipe/edit/IngredientRowEditor.tsx src/ui/recipe/edit/StepRowEditor.tsx src/routes/h/$householdId/import.tsx src/lib/i18n.en.ts src/lib/i18n.de.ts`
Expected: no errors on these files (fix any reported).

- [ ] **Step 3: Run all affected test files**

Run: `pnpm vitest run src/lib/forms/manual-recipe.test.ts src/ui/recipe/edit/RecipeEditForm.test.tsx src/ui/recipe/edit/IngredientRowEditor.test.tsx src/ui/recipe/edit/StepRowEditor.test.tsx`
Expected: PASS.

---

## Task 7: Visual validation (REQUIRED)

- [ ] **Step 1: Invoke the `validating-features-visually` skill** and follow its setup + procedure exactly.

Drive Playwright through: signup → open `/h/:householdId/import` → **Manual** tab → confirm the blank form (one empty ingredient row, one empty step row, "Save recipe" button) → fill title, servings, one ingredient line, one step body → Save → land on the new recipe's detail page showing the entered content. Capture **desktop and mobile** viewports for each step.

- [ ] **Step 2: Check the touched adjacent surface** — open an existing recipe's **edit** page and confirm the ingredient/step editors still render correctly (shared row editors gained the `error` prop) and that emptying a row line shows the new inline error.

- [ ] **Step 3: Triage screenshots** for flash-of-wrong-content, mobile overflow, and wrong field population. Fix any regressions and re-run.

---

## Self-Review (completed during planning)

- **Spec coverage:** inline Manual tab (Task 5) ✓; reuse `RecipeEditForm` + `save_recipe` + navigate (Task 5) ✓; `source_type:'manual'` & blank defaults (Task 1) ✓; row-error fix (Tasks 3–4) ✓; `submitLabel`/"Save recipe" (Tasks 2,4,5) ✓; i18n en+de (Task 2) ✓; Cancel→list (Task 5) ✓; unit + component tests (Tasks 1,3,4) ✓; visual validation (Task 7) ✓; non-goals respected (no `/new` route, no blocker, no quick-add, no image upload).
- **Placeholder scan:** none — every code step is concrete.
- **Type consistency:** `blankManualRecipe(locale: string): Recipe`, `error?: string` on both row editors, `submitLabel?: string` on `RecipeEditForm`, `Errors = FieldErrors<Recipe>` reused in both sections, `save_recipe` args `{ p_household, p_draft }` match existing call sites.

## Non-goals (YAGNI)

No dedicated `/new` route, no unsaved-changes route blocker, no free-text quick-add/parsing, no hero-image upload.
