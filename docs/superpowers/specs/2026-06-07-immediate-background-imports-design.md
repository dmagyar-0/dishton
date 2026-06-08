# Immediate background recipe imports + cross-session resilience

- **Date:** 2026-06-07
- **Status:** Draft for review
- **Branch:** `claude/eager-fermat-7efeed`

## Problem

Importing a recipe from a URL (and the sibling Instagram / Photo flows) currently
**blocks the import page in the foreground**: the SPA `await`s the edge function
while a progress animation plays, and the import only moves to the background if
the AI parse exceeds a 10 s server timer (`FIRST_RESPONSE_MS`) **or** the user
manually clicks "Continue in background" after ~12 s.

The only cross-page signal is a small nav pill
([`ActiveImportsIndicator`](../../../src/ui/shell/ActiveImportsIndicator.tsx)) that
shows the *newest* import's phase or a bare count. There is **no list** of
in-flight imports and their individual states, and completions that happen while
the browser is closed are **not announced** when the app is reopened.

## Goals

1. **Background immediately.** URL / Instagram / Photo imports detach to the
   background as soon as they are submitted — no foreground wait, no manual
   "continue" step. The form clears and the user can queue more (up to the
   existing concurrency cap of 5).
2. **See running imports.** The import page shows an inline list of in-flight
   imports and their live state (reading source → asking the model → saving →
   done / needs review / failed), visible across the URL/Photo/Manual tabs.
3. **Survive a browser close.** Imports keep running server-side if the browser
   closes; on reopen the recipe is finalized and an in-app pop-up announces
   results (including failures) that completed while the user was away.

## Non-goals

- **OS / Web Push notifications while the browser is fully closed.** The pop-up
  is in-app, fired on the next app open. Real Web Push (service-worker push
  handler, VAPID keys, a `push_subscriptions` table + RLS, an edge function that
  posts to the push service on completion, and a permission-prompt UX) is a
  possible follow-up, not part of this work.
- **A dedicated imports history page.** Per product decision the view is inline
  on the import page.
- **Fixing the pre-existing multi-tab double-save race** (see Known limitations).
- **Schema changes.** No change to the Recipe Zod schema or the SQL schema; no
  migration. Every column and status this design needs already exists.

## Current behavior (reference)

- **Import page** [`src/routes/h/$householdId/import.tsx`](../../../src/routes/h/$householdId/import.tsx):
  three tabs (URL / Photo / Manual). The URL and Photo submit handlers `await`
  `supabase.functions.invoke(...)` with a 120 s `AbortController`, render
  `<ImportProgress>` (which exposes a "Continue in background" button after
  ~12 s), and on a synchronous `200` call `save_recipe` then navigate to the new
  recipe. On a `202` they `registerImport(...)` and let realtime finish.
- **Edge functions** `import-url`, `import-instagram`, `import-photo`: insert an
  `import_jobs` row (`status='running'`, `phase='scrape'`), then
  `runWithBackgroundDetach` ([`_shared/import-runner.ts`](../../../supabase/functions/_shared/import-runner.ts))
  races the worker against a 10 s timer. Worker-wins → `200` + draft, row
  `status='done'`. Timer-wins → `202` + worker continues in
  `EdgeRuntime.waitUntil`, row `status='awaiting_save'`.
- **Provider** [`src/lib/imports/ActiveImportsProvider.tsx`](../../../src/lib/imports/ActiveImportsProvider.tsx):
  mounted above `AppShell`. Opens one realtime channel per profile on
  `app.import_jobs`; backfills `queued/running/awaiting_save` rows on mount;
  auto-saves `awaiting_save` rows via `saveFromAwaiting` (calls `save_recipe`
  with the SPA's JWT, then patches the row to `done`); TTL-expires terminal rows
  after 30 s.
- **`import_jobs`** schema already supports statuses
  `queued | running | awaiting_save | needs_review | done | failed`, a `phase`
  (`scrape | ai | saving`), `progress_text`, `payload` (jsonb, holds `url` /
  `draft` / token counts), `error`, `recipe_id`, `completed_at` (set by trigger
  on terminal status), and is in the `supabase_realtime` publication.

## Design

### Part A — Edge functions always detach to the background

Replace the timer race with an **always-background** path in all three import
functions.

- Add a helper to [`_shared/import-runner.ts`](../../../supabase/functions/_shared/import-runner.ts),
  e.g. `runDetached({ work, onFinish, onError })`, that:
  - starts `work()`,
  - schedules `work().then(onFinish, onError)` on `EdgeRuntime.waitUntil` (with
    the existing test-env fallback that keeps a reference so unhandled
    rejections don't kill the process),
  - returns immediately.
- Each function: after the **pre-flight** steps that already run before the
  worker — `resolveCaller`, body validation, `reap_stuck_imports`, the
  concurrency-cap check (`409 too_many_imports`), and the `import_jobs` row
  insert — call `runDetached(...)` and respond
  `202 { job_id, status: 'running', request_id }`.
- The worker's terminal writes lose the `sync|background` mode distinction:
  success always writes `status='awaiting_save'` (+ `phase='saving'`,
  `payload.draft`); model/content problems write `needs_review`; transient
  failures write `failed` (with `error`).
- Remove the now-dead synchronous response branches (`200` + draft, `429`
  `rate_limit`, `503` `upstream`). Those failure reasons now surface as
  `failed` / `needs_review` rows and reach the SPA via realtime, which already
  toasts them.
- `runWithBackgroundDetach` becomes unused once all three callers migrate;
  remove it (and its tests) or keep only if another caller exists (audit shows
  only the three import functions use it → remove).

**Why server-side, not client-only:** a client that simply stops awaiting would
drop sync-mode (`200`) recipes, which require the client to call `save_recipe`.
Routing every import through `awaiting_save` makes the realtime listener the
single save path. Setting `FIRST_RESPONSE_MS = 0` was rejected: it depends on
event-loop micro/macro-task ordering and could still resolve synchronously in
mock mode.

### Part B — Client submit simplification

In [`import.tsx`](../../../src/routes/h/$householdId/import.tsx) the URL and Photo
handlers collapse to: validate → (Photo: upload to the `imports` bucket) →
`await invoke` (now fast — kickoff only) → on success
`registerImport({ jobId, householdId, kind, sourceUrl })`, reset the form, and
push an info toast "Import started." Then the inline list and realtime take over.

Removed from the client:
- the `save_recipe` call, the navigate-to-recipe, and the `needs_review` toast
  branch (realtime handles completion + needs-review),
- the 120 s `AbortController` + `backgroundedRef` "continue in background"
  machinery,
- `<ImportProgress>` (and the component file — it is used nowhere else).

A modest kickoff timeout (e.g. 30 s) guards against a hung/cold-start invoke.
Pre-flight errors that still return synchronously (`409 too_many_imports`,
auth/network, body validation) are surfaced with the existing `readErrorCode` →
toast path.

### Part C — Inline imports list (the view)

New component `src/ui/recipe/ImportQueue.tsx`, rendered **page-level** in
`ImportPage` (below the `<Tabs>`), so it is visible regardless of the active tab.

- Reads `useActiveImports().items`, filtered to the current `householdId`.
- One row per import showing:
  - **kind icon** — Globe (url) / Instagram / Camera (photo),
  - **source** — URL host parsed from `sourceUrl`, else "Photo import",
  - **state** — Queued → Reading source → Asking the model → Saving → ✓ Imported
    / Needs review / Failed (reusing `import.phase_*`); a spinner while active,
    a status icon when terminal,
  - **action** — "View recipe" link when `done` (via `recipeId`); "Dismiss"
    (calls `dismiss(jobId)`) for terminal rows; failed rows render the mapped
    error message.
- Active rows persist; terminal rows auto-clear via the provider's existing 30 s
  TTL or on Dismiss.
- Empty state: render nothing (the list only appears when there are imports).

### Part D — Cross-session resilience + reopen pop-up

Server continuation and save-on-reopen already exist; Part A makes them apply to
every import (all kinds now go through `awaiting_save`). The new work is
announcing **terminal** completions that happened while away.

- **High-water-mark** in `localStorage`, per profile
  (`dishton:imports:lastNotified:<profileId>`), storing the `completed_at` of the
  most recent terminal import the user has already been notified about. Default
  on first run = *now* (no backlog spam on a fresh device).
- **On mount**, after the existing live-row backfill, query terminal rows
  (`status in ('done','failed','needs_review')`) with
  `completed_at > lastNotified` for the profile, ordered by `completed_at`.
  Surface them as a **persistent pop-up**:
  - exactly one `done` → "'⟨title⟩' imported while you were away — View recipe"
    (title from `payload.draft.title`, link via `recipe_id`),
  - multiple, or mixed with failures → an aggregated
    "N imports finished while you were away" plus a failure count,
  - also `upsert` these rows into `items` so the inline list reflects them.
- **Advance the mark** to the newest `completed_at` handled, and also advance it
  whenever a *live* realtime terminal event is surfaced — so a refresh never
  re-pops a completion the user already saw live.
- `awaiting_save` rows saved during the reopen backfill keep firing the existing
  "Recipe ready — View recipe" toast (those are themselves while-away
  completions); the high-water-mark logic ignores them at query time (they are
  not yet terminal) and they are not double-announced.

Net effect: close the browser mid-import → the server finishes it → reopen → the
recipe is saved and a pop-up reports the result (or the failure).

### Supporting changes

- **Provider** [`ActiveImportsProvider.tsx`](../../../src/lib/imports/ActiveImportsProvider.tsx):
  add `sourceUrl: string | null` to `ActiveImport`, `RegisterArgs`, the
  optimistic `register` insert, and `rowToActive` (from `row.payload.url`). Add
  the Part D high-water-mark + terminal-backfill logic.
- **Nav pill** [`ActiveImportsIndicator.tsx`](../../../src/ui/shell/ActiveImportsIndicator.tsx):
  wrap it in a link to the import page so the cross-page breadcrumb leads to the
  inline list. Minor; skip if the current household id is not readily available
  in the shell.
- **i18n** [`i18n.en.ts`](../../../src/lib/i18n.en.ts) + [`i18n.de.ts`](../../../src/lib/i18n.de.ts):
  add list/row/state/action strings and the "while you were away" pop-up
  strings; retire `import.step_*`, `import.background_button`,
  `import.long_wait_hint`, `import.preparing`, `import.progress_label` once
  `ImportProgress` is deleted. Keep `phase_*`, `ready_*`, `success_*`,
  `error_*`, `needs_review_*`.
- **Delete** `src/ui/recipe/ImportProgress.tsx`.

## Data model

No migration. The design uses existing columns only: `status`, `phase`,
`progress_text`, `payload` (`url`, `draft`), `error`, `recipe_id`,
`completed_at`, and the existing `supabase_realtime` publication on
`app.import_jobs`.

## Error handling

- **Pre-flight (synchronous):** concurrency cap → `409 too_many_imports`; auth /
  validation / network errors → mapped via `readErrorCode` to a toast.
- **In-flight (background):** worker writes `failed` (`rate_limit`, `upstream`,
  `internal`, scrape/fetch errors) or `needs_review` (parse/schema). Realtime
  delivers the row; the provider toasts using the existing `failedErrorKey` /
  needs-review copy, and the inline list shows the state. The 5-minute reaper
  still fails genuinely-stuck `running` rows.
- **Save (on reopen or live):** `saveFromAwaiting` failure leaves the row
  `awaiting_save` and clears the local `saved` guard so a later mount retries.

## Testing

- **Edge (Deno, `pnpm test:edge`):** for each of `import-url`,
  `import-instagram`, `import-photo`, add a handler test (mock mode) asserting
  the response is `202 { job_id, status: 'running' }` and that the row reaches
  `awaiting_save` (success) / `failed` / `needs_review` after the worker. Add a
  test for the new `runDetached` helper; remove `runWithBackgroundDetach` tests
  with it.
- **Component (Vitest, `pnpm test:components`):** `ImportQueue.test.tsx` covering
  each state (running phases with spinner, `done` + View-recipe link,
  `needs_review`, `failed` + error text, Dismiss), and household filtering.
- **Provider (Vitest):** Part D — seed terminal rows with `completed_at` past the
  stored mark → assert pop-up + mark advance; mark already ahead → assert no
  pop-up; `awaiting_save` backfill → assert save + "ready" toast, no duplicate.
- **Visual (required — `validating-features-visually`):** the sandbox runs
  Supabase **without** edge functions, so seed `import_jobs` rows directly
  (per CLAUDE.md's RLS-only guidance) to exercise the UI: (1) several rows in
  different live states → screenshot the inline list at desktop + mobile;
  (2) a `done` and a `failed` row with `completed_at` in the past + the
  localStorage mark behind them → reload → screenshot the reopen pop-up;
  (3) the submit form's optimistic clear + "Import started" toast via a mocked
  `functions.invoke`. Capture before/after at both viewports.

## Known limitations

- **Multi-tab double-save (pre-existing).** Routing 100% of imports through
  `saveFromAwaiting` slightly increases exposure to two tabs both saving the same
  `awaiting_save` row (the `saved` guard is per-tab). Out of scope here; a
  follow-up could add a row-claim (atomic conditional update) before
  `save_recipe`.
- **Push-while-closed** is out of scope (see Non-goals).
- **`waitUntil` budget.** A worker that exceeds the function's wall-time budget
  after the browser closes will not finish; the 5-minute reaper marks it
  `failed`, which the reopen pop-up then reports.

## File change list

- `supabase/functions/_shared/import-runner.ts` — add `runDetached`; remove
  `runWithBackgroundDetach`.
- `supabase/functions/_shared/import-runner.test.ts` — test `runDetached`.
- `supabase/functions/import-url/index.ts` — always-background; `202`; worker
  writes `awaiting_save`/`needs_review`/`failed`.
- `supabase/functions/import-instagram/index.ts` — same.
- `supabase/functions/import-photo/index.ts` — same.
- `supabase/functions/import-url/_test.ts`,
  `supabase/functions/import-instagram/_test.ts`,
  `supabase/functions/import-photo/_test.ts` — handler tests for `202` +
  terminal row.
- `src/routes/h/$householdId/import.tsx` — simplified submit; render
  `<ImportQueue>`; drop `<ImportProgress>`.
- `src/ui/recipe/ImportQueue.tsx` (new) + `ImportQueue.test.tsx` (new).
- `src/ui/recipe/ImportProgress.tsx` — delete.
- `src/lib/imports/ActiveImportsProvider.tsx` — `sourceUrl`; Part D
  high-water-mark + terminal backfill + pop-up.
- `src/lib/imports/ActiveImportsProvider.test.tsx` (if present / new) — Part D.
- `src/ui/shell/ActiveImportsIndicator.tsx` — link to import page (minor).
- `src/lib/i18n.en.ts`, `src/lib/i18n.de.ts` — add/retire strings.
