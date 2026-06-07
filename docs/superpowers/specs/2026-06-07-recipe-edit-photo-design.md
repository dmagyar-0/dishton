# Add a photo when editing a recipe — design

**Date:** 2026-06-07
**Status:** Approved

## Problem

`Recipe.hero_image_path` (`src/domain/recipe.ts`) already round-trips through the
edit form's defaults and is persisted by the `update_recipe` RPC — but there is
**no UI to set, replace, or remove it**. The edit form
(`src/ui/recipe/edit/RecipeEditForm.tsx`) only exposes Tags / Basics /
Ingredients / Steps. Today a hero image can only arrive via the import pipelines
(a remote URL scraped from a URL/Instagram source, or a promoted photo-import
blob). A user editing an existing ("available") recipe cannot attach their own
picture.

The plumbing to do this already exists and is proven:

- Client-side downscale before upload: `resizeForUpload` (`src/lib/photo-resize.ts`).
- The private `recipe-images` bucket with storage RLS that lets an authenticated
  user write only into their own folder, `recipe-images/<uid>/...`
  (`supabase/migrations/20260430120900_storage_policies.sql`).
- Signed-URL display for private paths (and verbatim pass-through for remote
  URLs): `RecipeImage` + `useImageUrl` (`src/lib/queries/storage.ts`).
- The canonical upload call site to mirror: the photo-import flow in
  `src/routes/h/$householdId/import.tsx` (`resizeForUpload` → `supabase.storage
  .from(bucket).upload('<uid>/<uuid>.<ext>', file, { contentType, upsert:false })`).

So this is a **front-end-only** feature: no schema, RPC, migration, or storage
policy changes.

## Decision

- **Approach:** upload on file-select. The selected file is resized and uploaded
  to the private bucket immediately, and the resulting object path is written
  into the form's `hero_image_path` field. This keeps the form model
  string-only and matches the existing import flow. (Considered and rejected:
  deferring upload until Save — marginally better orphan hygiene, but it makes
  the submit path an async upload-then-RPC and turns the form field into a
  derived value. Also rejected: paste-a-URL — awkward on phones; the user chose
  device upload.)
- **Scope:** the existing-recipe **edit** form only
  (`/h/$householdId/r/$recipeId/edit`). Manual-create and import-draft surfaces
  are out of scope; the new component is written so it can be reused there later.
- **Component:** one focused, independently testable component,
  `RecipeImageField`, wired into the edit form. No new dependencies.

## Design

### New `RecipeImageField` primitive

`src/ui/recipe/edit/RecipeImageField.tsx`. A self-contained image control:

```ts
type RecipeImageFieldProps = {
  // Current hero_image_path: a private-bucket object path, a remote http(s)
  // URL (imported), or null when there is no image.
  value: string | null;
  // Called with the new object path after a successful upload, or null on remove.
  onChange: (path: string | null) => void;
  disabled?: boolean;
};
```

- **Empty state:** a dashed `aspect-[3/2]` drop-zone with an "Add photo" button
  that opens a hidden `<input type="file" accept="image/jpeg,image/png">`. No
  `capture` attribute, so the OS picker still offers camera *or* library on
  mobile.
- **Filled state:** the image previewed in the same `aspect-[3/2]` `object-cover`
  frame the detail page uses, with **Replace** (re-opens the picker) and
  **Remove** (`onChange(null)`) buttons.
- **Uploading:** a spinner overlay; Add/Replace/Remove disabled until it settles.

### Upload flow (on select)

1. Guard the file: reject types outside `['image/jpeg','image/png']`
   (`errors.photo_wrong_type`) and sizes over `10 MB` (`errors.photo_too_large`).
   These mirror `PHOTO_ACCEPTED_TYPES` / `PHOTO_MAX_BYTES` in `import.tsx`;
   defined locally in the field (no shared-constant refactor — see Non-goals).
2. Show an instant preview from `URL.createObjectURL(file)` (revoked on the next
   change / unmount) so there is no wait for a signed URL.
3. `resizeForUpload(file)` (returns the original on failure / when small).
4. `supabase.auth.getUser()` → `uid`; on failure surface `errors.internal`.
5. `path = '<uid>/<crypto.randomUUID()>.<ext>'` where `ext` is `png` when the
   final file is `image/png`, else `jpg` (matches import).
6. `supabase.storage.from(RECIPE_IMAGES_BUCKET).upload(path, file,
   { contentType: file.type, upsert: false })`. On error: `errors.photo_upload_failed`.
7. `onChange(path)`.

### Preview resolution

Existing persisted values render through `RecipeImage` (signs private paths via
the user's own `<uid>/...` read grant; passes remote import URLs through
verbatim). A just-picked file renders from its local object URL until the form is
saved. The field prefers the object URL when one exists, else falls back to
`RecipeImage value`.

### Integration into the edit form

- A new **Photo** `Card` section in `RecipeEditForm`, placed first (the hero is
  the most prominent element on the recipe page), driven by a `Controller` on
  `hero_image_path` rendering `RecipeImageField`. Selecting/removing flips the
  form `isDirty` exactly like the other fields, so the existing dirty-tracking
  and unsaved-changes blocker (`edit.tsx`) cover it for free.
- Save is unchanged: `hero_image_path` is already part of the draft the
  `update_recipe` RPC writes.

### Orphaned-blob cleanup (best-effort)

Following the convention already in `useDeleteRecipe` ("an orphaned blob is a
cleanup concern, not a user error"):

- **At save**, in `edit.tsx`'s success path: if the *original* persisted
  `hero_image_path` (from `recipeQ.data`) was an owned blob (not remote, not
  null) and differs from the saved value, best-effort `remove()` it.
- **Within the field**, when the user replaces or removes an image they uploaded
  *earlier in the same session*, best-effort `remove()` that prior
  session-uploaded blob (tracked in a ref) so repeated replaces don't pile up.
- Imported remote URLs are never deleted (not ours). Uploading then abandoning
  the edit without saving leaves at most one orphan — tolerated, as above.

### Error handling

Type / size / upload failures show an inline message under the control and a
toast; the rest of the recipe stays editable. A resize failure is non-fatal
(`resizeForUpload` falls back to the original file).

### i18n

Add to both `src/lib/i18n.en.ts` and `src/lib/i18n.de.ts` under `recipe.`:
`section_photo`, `photo_add`, `photo_replace`, `photo_remove`, `photo_uploading`,
`photo_alt`. Reuse the existing `errors.photo_wrong_type`,
`errors.photo_too_large`, `errors.photo_upload_failed`, and `errors.internal`.

## Tests & docs

- New `src/ui/recipe/edit/RecipeImageField.test.tsx` (Vitest + Testing Library,
  mocking `@/lib/supabase`, `@/lib/photo-resize`, and `URL.createObjectURL`):
  empty state shows "Add photo"; a value shows the preview + Replace/Remove;
  selecting a valid file resizes, uploads to `recipe-images/<uid>/…`, and calls
  `onChange(path)`; a wrong type / oversized file shows the error and does **not**
  call `onChange`; Remove calls `onChange(null)`.
- Extend `RecipeEditForm.test.tsx`: the Photo section renders, and a recipe with
  a `hero_image_path` shows the filled control.
- No domain or migration tests change (the schema and RPC already carry the
  field).

## Validation

Run the `validating-features-visually` skill before claiming done — Playwright
through signup → open an existing recipe → edit → add a photo → save → confirm it
shows on the detail and list views, plus replace and remove, at desktop and
mobile viewports. (The write/read path is pure Supabase RLS + storage, so it is
exercisable against the local stack without the import Edge Functions.)

## Implementation order

1. (TDD) Write `RecipeImageField.test.tsx` against the API above → red.
2. Implement `RecipeImageField.tsx` → green; refactor.
3. Add the Photo `Controller` section to `RecipeEditForm`; extend its test.
4. Add save-time orphan cleanup to `edit.tsx`.
5. Add the `recipe.photo_*` i18n keys (en + de).
6. `pnpm typecheck && pnpm lint`; run the two affected test files.
7. Visual validation; then commit + push.

## Non-goals

- No cropping / rotation / filter UI (display `object-cover` handles framing).
- No multi-image gallery — single hero only.
- No paste-an-image-URL input.
- No photo control on manual-create or import-draft surfaces (reuse later).
- No schema, RPC, migration, or storage-policy changes.
- No refactor of `import.tsx`'s local photo constants into a shared module.
