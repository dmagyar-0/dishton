# Add a Photo When Editing a Recipe — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an editor add, replace, or remove the hero photo of an existing recipe from the recipe edit form.

**Architecture:** Front-end only. A new `RecipeImageField` component uploads a (client-side-resized) image into the private `recipe-images/<uid>/...` bucket and reports the resulting object path; the edit form binds it to the existing `hero_image_path` field via a react-hook-form `Controller`, and the unchanged `update_recipe` RPC persists it. Best-effort cleanup frees blobs that get orphaned by a swap/remove. No schema, RPC, migration, or storage-policy change.

**Tech Stack:** React 19, react-hook-form, TanStack Router, Supabase JS (Storage), Vitest + Testing Library, i18next.

Reference spec: `docs/superpowers/specs/2026-06-07-recipe-edit-photo-design.md`.

---

## File Structure

- **Create** `src/ui/recipe/edit/RecipeImageField.tsx` — the self-contained image control (file pick → validate → resize → upload → `onChange(path)`; replace/remove; instant local preview).
- **Create** `src/ui/recipe/edit/RecipeImageField.test.tsx` — its component test.
- **Modify** `src/ui/recipe/edit/RecipeEditForm.tsx` — add a "Photo" section bound to `hero_image_path`.
- **Modify** `src/ui/recipe/edit/RecipeEditForm.test.tsx` — assert the section renders.
- **Modify** `src/lib/queries/storage.ts` — add the pure `staleHeroImagePath` cleanup predicate.
- **Create** `src/lib/queries/storage.test.ts` — unit-test that predicate.
- **Modify** `src/routes/h/$householdId/r/$recipeId/edit.tsx` — best-effort free the previous blob on a successful save.
- **Modify** `src/lib/i18n.en.ts` and `src/lib/i18n.de.ts` — `recipe.photo_*` strings.

---

## Task 1: i18n strings

**Files:**
- Modify: `src/lib/i18n.en.ts:354`
- Modify: `src/lib/i18n.de.ts:366`

- [ ] **Step 1: Add the English strings**

In `src/lib/i18n.en.ts`, find:

```ts
    section_tags: 'Tags',
    field_title: 'Title',
```

Replace with:

```ts
    section_tags: 'Tags',
    section_photo: 'Photo',
    photo_add: 'Add photo',
    photo_replace: 'Replace photo',
    photo_remove: 'Remove photo',
    photo_uploading: 'Uploading…',
    photo_alt: 'Recipe photo',
    field_title: 'Title',
```

- [ ] **Step 2: Add the German strings**

In `src/lib/i18n.de.ts`, find:

```ts
    section_tags: 'Tags',
    field_title: 'Titel',
```

Replace with:

```ts
    section_tags: 'Tags',
    section_photo: 'Foto',
    photo_add: 'Foto hinzufügen',
    photo_replace: 'Foto ersetzen',
    photo_remove: 'Foto entfernen',
    photo_uploading: 'Wird hochgeladen…',
    photo_alt: 'Rezeptfoto',
    field_title: 'Titel',
```

- [ ] **Step 3: Typecheck (the de bundle is typed against en, so a missing key fails here)**

Run: `pnpm typecheck`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add src/lib/i18n.en.ts src/lib/i18n.de.ts
git commit -m "i18n: recipe photo-field strings (en, de)"
```

---

## Task 2: `RecipeImageField` component (TDD)

**Files:**
- Create: `src/ui/recipe/edit/RecipeImageField.tsx`
- Test: `src/ui/recipe/edit/RecipeImageField.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/ui/recipe/edit/RecipeImageField.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Render-only stub so this test doesn't pull in the signed-URL query layer.
vi.mock('@/ui/primitives/RecipeImage', () => ({
  RecipeImage: ({ path, alt }: { path: string | null; alt?: string }) => (
    <img data-testid="recipe-image" data-path={path ?? ''} alt={alt ?? ''} />
  ),
}));

vi.mock('@/lib/photo-resize', () => ({
  resizeForUpload: vi.fn(async (f: File) => f),
}));

const mocks = vi.hoisted(() => {
  const uploadMock = vi.fn();
  const removeMock = vi.fn();
  const getUserMock = vi.fn();
  const storageFromMock = vi.fn(() => ({ upload: uploadMock, remove: removeMock }));
  return { uploadMock, removeMock, getUserMock, storageFromMock };
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: mocks.getUserMock },
    storage: { from: mocks.storageFromMock },
  },
}));

import { RecipeImageField } from './RecipeImageField';

function jpeg(name = 'photo.jpg', bytes = 10): File {
  return new File([new Uint8Array(bytes)], name, { type: 'image/jpeg' });
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (!input) throw new Error('no file input rendered');
  return input as HTMLInputElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  mocks.uploadMock.mockResolvedValue({ data: { path: 'ok' }, error: null });
  mocks.removeMock.mockResolvedValue({ data: [{}], error: null });
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview');
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe('RecipeImageField', () => {
  it('shows the add-photo affordance when empty', () => {
    render(<RecipeImageField value={null} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'recipe.photo_add' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'recipe.photo_remove' })).not.toBeInTheDocument();
  });

  it('shows a preview plus replace/remove when a value is set', () => {
    render(<RecipeImageField value="u1/hero.jpg" onChange={vi.fn()} />);
    expect(screen.getByTestId('recipe-image')).toHaveAttribute('data-path', 'u1/hero.jpg');
    expect(screen.getByRole('button', { name: 'recipe.photo_replace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'recipe.photo_remove' })).toBeInTheDocument();
  });

  it('uploads a picked file to the user folder and reports the path', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RecipeImageField value={null} onChange={onChange} />);

    await user.upload(fileInput(), jpeg());

    expect(mocks.getUserMock).toHaveBeenCalled();
    expect(mocks.storageFromMock).toHaveBeenCalledWith('recipe-images');
    expect(mocks.uploadMock).toHaveBeenCalledTimes(1);
    const call = mocks.uploadMock.mock.calls[0];
    if (!call) throw new Error('upload not called');
    const [path, file, opts] = call;
    expect(path).toMatch(/^u1\/[0-9a-f-]+\.jpg$/);
    expect(file).toBeInstanceOf(File);
    expect(opts).toEqual({ contentType: 'image/jpeg', upsert: false });
    expect(onChange).toHaveBeenCalledWith(path);
  });

  it('rejects a non-image type without uploading', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RecipeImageField value={null} onChange={onChange} />);

    await user.upload(
      fileInput(),
      new File([new Uint8Array(4)], 'note.gif', { type: 'image/gif' }),
    );

    expect(screen.getByText('errors.photo_wrong_type')).toBeInTheDocument();
    expect(mocks.uploadMock).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('rejects a file over the size limit without uploading', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RecipeImageField value={null} onChange={onChange} />);

    const big = jpeg('big.jpg', 1);
    Object.defineProperty(big, 'size', { value: 10 * 1024 * 1024 + 1 });
    await user.upload(fileInput(), big);

    expect(screen.getByText('errors.photo_too_large')).toBeInTheDocument();
    expect(mocks.uploadMock).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('surfaces an error when the upload fails', async () => {
    mocks.uploadMock.mockResolvedValue({ data: null, error: { message: 'denied' } });
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RecipeImageField value={null} onChange={onChange} />);

    await user.upload(fileInput(), jpeg());

    expect(screen.getByText('errors.photo_upload_failed')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clears the value when removed', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RecipeImageField value="u1/hero.jpg" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'recipe.photo_remove' }));

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('frees a same-session upload when it is replaced', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RecipeImageField value={null} onChange={onChange} />);

    await user.upload(fileInput(), jpeg('first.jpg'));
    const firstCall = onChange.mock.calls[0];
    if (!firstCall) throw new Error('onChange not called for first upload');
    const firstPath = firstCall[0] as string;
    onChange.mockClear();

    await user.upload(fileInput(), jpeg('second.jpg'));

    expect(mocks.removeMock).toHaveBeenCalledWith([firstPath]);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/ui/recipe/edit/RecipeImageField.test.tsx`
Expected: FAIL — `Failed to resolve import "./RecipeImageField"` (module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/ui/recipe/edit/RecipeImageField.tsx`:

```tsx
import { resizeForUpload } from '@/lib/photo-resize';
import { RECIPE_IMAGES_BUCKET } from '@/lib/queries/storage';
import { supabase } from '@/lib/supabase';
import { Button } from '@/ui/primitives/Button';
import { RecipeImage } from '@/ui/primitives/RecipeImage';
import { ImagePlus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

// Mirror the photo limits the import flow enforces (src/routes/h/$householdId/import.tsx).
const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const PHOTO_ACCEPTED_TYPES = ['image/jpeg', 'image/png'] as const;

export type RecipeImageFieldProps = {
  // Current hero_image_path: a private-bucket object path, a remote http(s) URL
  // (imported), or null when there is no image.
  value: string | null;
  // Called with the new object path after a successful upload, or null on remove.
  onChange: (path: string | null) => void;
  disabled?: boolean;
};

export function RecipeImageField({ value, onChange, disabled }: RecipeImageFieldProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Instant local preview for a just-picked file, shown until the page is saved
  // (the persisted value renders through RecipeImage instead).
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  // Path of the blob we uploaded earlier in THIS edit session, if any. Lets us
  // free it when the user replaces/removes it again before saving — without
  // touching the originally-persisted image (still referenced until save).
  const sessionUploadRef = useRef<string | null>(null);

  // Revoke the object URL when it is replaced or the field unmounts.
  useEffect(() => {
    return () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    };
  }, [localPreview]);

  function openPicker() {
    setError(null);
    inputRef.current?.click();
  }

  async function freeSessionUpload() {
    const prev = sessionUploadRef.current;
    sessionUploadRef.current = null;
    if (!prev) return;
    try {
      await supabase.storage.from(RECIPE_IMAGES_BUCKET).remove([prev]);
    } catch {
      // best-effort — an orphaned blob is a cleanup concern, not a user error
    }
  }

  async function handleFile(file: File) {
    if (!(PHOTO_ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
      setError(t('errors.photo_wrong_type'));
      return;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      setError(t('errors.photo_too_large'));
      return;
    }
    setError(null);
    setUploading(true);
    setLocalPreview(URL.createObjectURL(file)); // effect revokes any previous

    try {
      const { data, error: userErr } = await supabase.auth.getUser();
      if (userErr || !data.user) {
        setError(t('errors.internal'));
        setLocalPreview(null);
        return;
      }
      // resizeForUpload returns the original file on failure or when no resize
      // is needed; it converts resized output to JPEG.
      const prepared = await resizeForUpload(file);
      const ext = prepared.type === 'image/png' ? 'png' : 'jpg';
      const path = `${data.user.id}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from(RECIPE_IMAGES_BUCKET)
        .upload(path, prepared, { contentType: prepared.type, upsert: false });
      if (uploadErr) {
        setError(t('errors.photo_upload_failed'));
        setLocalPreview(null);
        return;
      }
      await freeSessionUpload();
      sessionUploadRef.current = path;
      onChange(path);
    } catch {
      setError(t('errors.photo_upload_failed'));
      setLocalPreview(null);
    } finally {
      setUploading(false);
    }
  }

  async function handleRemove() {
    setError(null);
    await freeSessionUpload();
    setLocalPreview(null);
    onChange(null);
  }

  const hasImage = Boolean(localPreview || value);

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept={PHOTO_ACCEPTED_TYPES.join(',')}
        className="sr-only"
        disabled={disabled || uploading}
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Reset so re-picking the same file fires change again.
          e.target.value = '';
          if (file) void handleFile(file);
        }}
      />

      <div className="relative aspect-[3/2] overflow-hidden rounded-[var(--radius-lg)] border border-cream-line bg-paper-2">
        {hasImage ? (
          localPreview ? (
            <img
              src={localPreview}
              alt={t('recipe.photo_alt')}
              className="h-full w-full object-cover"
            />
          ) : (
            <RecipeImage path={value} alt={t('recipe.photo_alt')} className="h-full w-full object-cover" />
          )
        ) : (
          <button
            type="button"
            onClick={openPicker}
            disabled={disabled || uploading}
            className="flex h-full w-full flex-col items-center justify-center gap-2 border-2 border-dashed border-cream-line text-ink-soft transition-colors hover:bg-paper hover:text-ink"
          >
            <ImagePlus size={28} strokeWidth={1.5} />
            <span className="font-body text-sm">{t('recipe.photo_add')}</span>
          </button>
        )}

        {uploading && (
          <div className="absolute inset-0 flex items-center justify-center bg-paper/70">
            <span className="font-body text-sm text-ink-soft">{t('recipe.photo_uploading')}</span>
          </div>
        )}
      </div>

      {hasImage && (
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={openPicker}
            disabled={disabled || uploading}
            leftIcon={<ImagePlus size={16} strokeWidth={1.5} />}
          >
            {t('recipe.photo_replace')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void handleRemove()}
            disabled={disabled || uploading}
            leftIcon={<Trash2 size={16} strokeWidth={1.5} />}
          >
            {t('recipe.photo_remove')}
          </Button>
        </div>
      )}

      {error && <p className="text-xs text-pomegranate">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/ui/recipe/edit/RecipeImageField.test.tsx`
Expected: PASS (8 tests).

- [ ] **Step 5: Typecheck and lint the new files**

Run: `pnpm typecheck`
Run: `pnpm exec biome check src/ui/recipe/edit/RecipeImageField.tsx src/ui/recipe/edit/RecipeImageField.test.tsx`
Expected: both PASS (no errors).

- [ ] **Step 6: Commit**

```bash
git add src/ui/recipe/edit/RecipeImageField.tsx src/ui/recipe/edit/RecipeImageField.test.tsx
git commit -m "feat(recipe-edit): RecipeImageField upload control"
```

---

## Task 3: Wire the Photo section into the edit form

**Files:**
- Modify: `src/ui/recipe/edit/RecipeEditForm.tsx`
- Test: `src/ui/recipe/edit/RecipeEditForm.test.tsx`

- [ ] **Step 1: Extend the form test (failing)**

In `src/ui/recipe/edit/RecipeEditForm.test.tsx`, add this mock immediately after the existing `react-i18next` mock (lines 6-8) so the form test does not pull in Supabase/storage:

```tsx
// The image field has its own test; stub it here so the form test stays a pure
// form-behaviour test (no Supabase/storage imports).
vi.mock('./RecipeImageField', () => ({
  RecipeImageField: ({ value }: { value: string | null }) => (
    <div data-testid="recipe-image-field" data-value={value ?? ''} />
  ),
}));
```

Then add this test inside the `describe('RecipeEditForm', ...)` block:

```tsx
  it('renders the photo section with the image field bound to hero_image_path', () => {
    render(
      <RecipeEditForm
        defaultValues={{ ...sampleRecipe(), hero_image_path: 'u1/hero.jpg' }}
        allowedTags={ALLOWED}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText('recipe.section_photo')).toBeInTheDocument();
    expect(screen.getByTestId('recipe-image-field')).toHaveAttribute('data-value', 'u1/hero.jpg');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/ui/recipe/edit/RecipeEditForm.test.tsx`
Expected: FAIL — `Unable to find an element with the text: recipe.section_photo`.

- [ ] **Step 3: Import the field in the form**

In `src/ui/recipe/edit/RecipeEditForm.tsx`, find:

```ts
import { IngredientRowEditor, type IngredientRowValue } from './IngredientRowEditor';
import { StepRowEditor, type StepRowValue } from './StepRowEditor';
```

Replace with:

```ts
import { IngredientRowEditor, type IngredientRowValue } from './IngredientRowEditor';
import { RecipeImageField } from './RecipeImageField';
import { StepRowEditor, type StepRowValue } from './StepRowEditor';
```

- [ ] **Step 4: Render the section first in the form**

In `src/ui/recipe/edit/RecipeEditForm.tsx`, find:

```tsx
    <form onSubmit={submit} className="space-y-8" noValidate data-dirty={isDirty || undefined}>
      <TagsSection control={control} allowedTags={allowedTags} />
```

Replace with:

```tsx
    <form onSubmit={submit} className="space-y-8" noValidate data-dirty={isDirty || undefined}>
      <PhotoSection control={control} isSubmitting={isSubmitting} />
      <TagsSection control={control} allowedTags={allowedTags} />
```

- [ ] **Step 5: Add the `PhotoSection` component**

In `src/ui/recipe/edit/RecipeEditForm.tsx`, find the `TagsSection` definition:

```tsx
function TagsSection({
  control,
  allowedTags,
}: {
  control: Control<Recipe>;
  allowedTags: readonly string[];
}) {
```

Insert this component immediately **before** it:

```tsx
function PhotoSection({
  control,
  isSubmitting,
}: {
  control: Control<Recipe>;
  isSubmitting?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Card as="section">
      <SectionHeading>{t('recipe.section_photo')}</SectionHeading>
      <Controller
        control={control}
        name="hero_image_path"
        render={({ field }) => (
          <RecipeImageField value={field.value} onChange={field.onChange} disabled={isSubmitting} />
        )}
      />
    </Card>
  );
}

```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm vitest run src/ui/recipe/edit/RecipeEditForm.test.tsx`
Expected: PASS (all tests, including the new one).

- [ ] **Step 7: Typecheck and lint**

Run: `pnpm typecheck`
Run: `pnpm exec biome check src/ui/recipe/edit/RecipeEditForm.tsx src/ui/recipe/edit/RecipeEditForm.test.tsx`
Expected: both PASS.

- [ ] **Step 8: Commit**

```bash
git add src/ui/recipe/edit/RecipeEditForm.tsx src/ui/recipe/edit/RecipeEditForm.test.tsx
git commit -m "feat(recipe-edit): add Photo section to the edit form"
```

---

## Task 4: Free the previous blob on save (TDD helper + wiring)

**Files:**
- Modify: `src/lib/queries/storage.ts`
- Test: `src/lib/queries/storage.test.ts`
- Modify: `src/routes/h/$householdId/r/$recipeId/edit.tsx`

- [ ] **Step 1: Write the failing helper test**

Create `src/lib/queries/storage.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

// storage.ts imports the supabase client at module load; stub it so the pure
// helper under test imports without real env/config.
vi.mock('../supabase', () => ({ supabase: { storage: { from: vi.fn() } } }));

import { staleHeroImagePath } from './storage';

describe('staleHeroImagePath', () => {
  it('returns the previous owned path when it changed', () => {
    expect(staleHeroImagePath('u1/a.jpg', 'u1/b.jpg')).toBe('u1/a.jpg');
  });

  it('returns the previous owned path when the image was removed', () => {
    expect(staleHeroImagePath('u1/a.jpg', null)).toBe('u1/a.jpg');
  });

  it('returns null when the path is unchanged', () => {
    expect(staleHeroImagePath('u1/a.jpg', 'u1/a.jpg')).toBeNull();
  });

  it('returns null when there was no previous image', () => {
    expect(staleHeroImagePath(null, 'u1/b.jpg')).toBeNull();
  });

  it('never deletes a remote (imported) URL', () => {
    expect(staleHeroImagePath('https://cdn.example.com/x.jpg', 'u1/b.jpg')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/queries/storage.test.ts`
Expected: FAIL — `staleHeroImagePath is not a function` (not exported yet).

- [ ] **Step 3: Add the helper**

In `src/lib/queries/storage.ts`, find:

```ts
export function isRemoteImageUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}
```

Insert immediately **after** it:

```ts

// Given the hero_image_path a recipe had when an edit began (`previous`) and the
// path after saving (`next`), return the owned bucket object that is now
// orphaned and safe to delete, or null when there is nothing to free. Remote
// (imported) URLs are never ours to delete, and an unchanged path is still
// referenced.
export function staleHeroImagePath(previous: string | null, next: string | null): string | null {
  if (!previous || previous === next) return null;
  if (isRemoteImageUrl(previous)) return null;
  return previous;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/queries/storage.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire cleanup into the edit page — imports**

In `src/routes/h/$householdId/r/$recipeId/edit.tsx`, find:

```ts
import {
  type FullRecipe,
  useIsRecipeEditor,
  useRecipe,
  useUpdateRecipe,
} from '@/lib/queries/recipes';
```

Insert immediately **after** it:

```ts
import { RECIPE_IMAGES_BUCKET, staleHeroImagePath } from '@/lib/queries/storage';
import { supabase } from '@/lib/supabase';
```

- [ ] **Step 6: Wire cleanup into the edit page — handler**

In the same file, find:

```ts
  const handleSubmit = async (values: Recipe) => {
    try {
      await update.mutateAsync({
        draft: values,
        expectedUpdatedAt: recipeQ.data?.recipe.updated_at ?? null,
      });
      dirtyRef.current = false;
      push({
```

Replace with:

```ts
  const handleSubmit = async (values: Recipe) => {
    const previousHero = recipeQ.data?.recipe.hero_image_path ?? null;
    try {
      await update.mutateAsync({
        draft: values,
        expectedUpdatedAt: recipeQ.data?.recipe.updated_at ?? null,
      });
      dirtyRef.current = false;
      // Best-effort: free the previous hero blob when the user swapped or
      // removed it. An orphaned blob is a cleanup concern, not a user error.
      const stale = staleHeroImagePath(previousHero, values.hero_image_path);
      if (stale) {
        void supabase.storage.from(RECIPE_IMAGES_BUCKET).remove([stale]).catch(() => undefined);
      }
      push({
```

- [ ] **Step 7: Typecheck, lint, and run the affected tests**

Run: `pnpm typecheck`
Run: `pnpm exec biome check src/lib/queries/storage.ts src/lib/queries/storage.test.ts "src/routes/h/$householdId/r/$recipeId/edit.tsx"`
Run: `pnpm vitest run src/lib/queries/storage.test.ts`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/queries/storage.ts src/lib/queries/storage.test.ts "src/routes/h/$householdId/r/$recipeId/edit.tsx"
git commit -m "feat(recipe-edit): free the previous hero blob on save"
```

---

## Task 5: Whole-feature verification + visual validation

**Files:** none (verification only).

- [ ] **Step 1: Typecheck + lint the full change set**

Run: `pnpm typecheck`
Run: `pnpm exec biome check src/ui/recipe/edit/RecipeImageField.tsx src/ui/recipe/edit/RecipeImageField.test.tsx src/ui/recipe/edit/RecipeEditForm.tsx src/ui/recipe/edit/RecipeEditForm.test.tsx src/lib/queries/storage.ts src/lib/queries/storage.test.ts src/lib/i18n.en.ts src/lib/i18n.de.ts "src/routes/h/$householdId/r/$recipeId/edit.tsx"`
Expected: both PASS. (Lint only changed files: Windows CRLF makes a whole-repo `pnpm lint` report false failures; CI on LF is the source of truth.)

- [ ] **Step 2: Run the component + lib test suites**

Run: `pnpm test:components`
Expected: PASS (existing suites plus the new `RecipeImageField`, `storage`, and updated `RecipeEditForm` tests).

- [ ] **Step 3: Visual validation (required by CLAUDE.md)**

Invoke the `validating-features-visually` skill and follow it exactly. Drive Playwright through: signup → open an existing recipe → Edit → **Add photo** (upload a fixture image) → Save → confirm the hero shows on the detail page and the list card → re-open Edit → **Replace** → Save → **Remove** → Save. Capture screenshots at desktop and mobile viewports. Because the write/read path is pure Supabase Storage + RLS, it is exercisable against the local stack without the import Edge Functions (seed a recipe row directly if needed).

- [ ] **Step 4: Push the branch**

```bash
git push -u origin claude/naughty-lovelace-152932
```

---

## Notes for the implementer

- **Single-file test command:** `pnpm vitest run <path>` (the package scripts only run whole globs).
- **Lint command:** `pnpm exec biome check <files>` — lint the files you changed, not the whole repo (Windows CRLF noise).
- **Why no migration:** `update_recipe` already writes `hero_image_path` from the draft, and storage RLS already permits writes to `recipe-images/<uid>/...`. Confirm you have NOT added any file under `supabase/migrations/`.
- **Frozen contract:** `Recipe` (`src/domain/recipe.ts`) is unchanged — `hero_image_path` already exists. Do not edit the schema.
