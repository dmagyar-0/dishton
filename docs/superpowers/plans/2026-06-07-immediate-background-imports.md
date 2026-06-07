# Immediate Background Imports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make URL/Instagram/Photo recipe imports detach to the background immediately, show an inline list of in-flight imports + their state on the import page, and announce completions/failures with an in-app pop-up when the app is reopened.

**Architecture:** The three import edge functions stop racing a sync timer and instead always run the worker in `EdgeRuntime.waitUntil` and return `202` immediately; the worker writes `awaiting_save`/`needs_review`/`failed`. The SPA's existing realtime listener (`ActiveImportsProvider`) becomes the single save path and gains a `localStorage` high-water-mark that surfaces while-you-were-away terminal completions as a persistent toast on mount. A new pure `ImportQueue` component renders the in-flight list on the import page.

**Tech Stack:** Deno edge functions (Supabase), React + TanStack Router/Query, Supabase Realtime, Vitest (components), Deno test (edge), react-i18next, Biome.

**Spec:** `docs/superpowers/specs/2026-06-07-immediate-background-imports-design.md`

---

## File Structure

**Edge (Deno):**
- `supabase/functions/_shared/import-runner.ts` — replace `runWithBackgroundDetach` with `runDetached` (always background, returns void).
- `supabase/functions/_shared/import-runner.test.ts` — replace tests with `runDetached` tests.
- `supabase/functions/import-url/index.ts` — always-background; `202`; `onFinish` drops `mode`.
- `supabase/functions/import-instagram/index.ts` — same.
- `supabase/functions/import-photo/index.ts` — same.

**SPA:**
- `src/lib/imports/ActiveImportsProvider.tsx` — add `sourceUrl`; expand failed-code mapping; Part D high-water-mark + terminal backfill + reopen pop-up.
- `src/ui/recipe/ImportQueue.tsx` (new) — pure presentational list (props: `items`, `onDismiss`, `onView`).
- `src/ui/recipe/ImportQueue.test.tsx` (new) — component tests.
- `src/routes/h/$householdId/import.tsx` — simplify submit handlers; render connected `ImportQueue` wrapper; drop `ImportProgress`.
- `src/ui/recipe/ImportProgress.tsx` — delete.
- `src/ui/shell/ActiveImportsIndicator.tsx` — wrap in a link to the import page.
- `src/lib/i18n.en.ts`, `src/lib/i18n.de.ts` — add queue/pop-up strings; retire `ImportProgress` strings.

**Commands (run from repo root):**
- Edge tests: `pnpm test:edge`
- Component tests: `pnpm test:components` (or a single file: `pnpm vitest run src/ui/recipe/ImportQueue.test.tsx`)
- Typecheck: `pnpm typecheck`
- Lint changed files: `pnpm lint` (on Windows, validate changed files; CI on LF is the source of truth)

---

## Task 1: `runDetached` edge helper

**Files:**
- Modify: `supabase/functions/_shared/import-runner.ts`
- Test: `supabase/functions/_shared/import-runner.test.ts`

- [ ] **Step 1: Replace the runner test file** with tests for `runDetached`.

```ts
// Unit tests for runDetached. The worker always runs post-response via
// EdgeRuntime.waitUntil; runDetached returns immediately (does not await work),
// routes the resolved value to onFinish, and routes a throw to onError.

import { assert, assertEquals } from 'jsr:@std/assert';
import { runDetached } from './import-runner.ts';

Deno.test('runDetached: returns before work completes', () => {
  let finished = false;
  runDetached({
    work: async () => {
      await new Promise((r) => setTimeout(r, 20));
      finished = true;
      return 'x';
    },
    onFinish: async () => {},
    onError: async () => {},
  });
  assertEquals(finished, false);
});

Deno.test('runDetached: routes the worker value to onFinish', async () => {
  const calls: string[] = [];
  let resolve!: () => void;
  const done = new Promise<void>((r) => (resolve = r));
  runDetached({
    work: async () => 'hello',
    onFinish: async (v) => {
      calls.push(v);
      resolve();
    },
    onError: async () => {},
  });
  await done;
  assertEquals(calls, ['hello']);
});

Deno.test('runDetached: routes a worker throw to onError', async () => {
  const errors: unknown[] = [];
  let resolve!: () => void;
  const done = new Promise<void>((r) => (resolve = r));
  runDetached({
    work: async () => {
      throw new Error('boom');
    },
    onFinish: async () => {},
    onError: async (e) => {
      errors.push(e);
      resolve();
    },
  });
  await done;
  assertEquals(errors.length, 1);
  assert(errors[0] instanceof Error);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test:edge`
Expected: FAIL — `runDetached` is not exported from `import-runner.ts`.

- [ ] **Step 3: Replace the body of `import-runner.ts`** with `runDetached`.

```ts
// runDetached: run an import worker entirely in the background. The worker
// starts immediately, its terminal write is scheduled via
// EdgeRuntime.waitUntil so the Supabase runtime keeps it alive after the HTTP
// response is sent, and runDetached returns at once so the caller can respond
// 202. The worker must not write terminal state itself — onFinish does that
// ('awaiting_save' on success, 'needs_review'/'failed' otherwise) and onError
// handles a thrown worker. Neither callback may throw; wrap your own try/catch.

declare const EdgeRuntime: {
  waitUntil: (promise: Promise<unknown>) => void;
} | undefined;

export type DetachHandlers<T> = {
  work: () => Promise<T>;
  onFinish: (value: T) => Promise<void>;
  onError: (err: unknown) => Promise<void>;
};

export function runDetached<T>(opts: DetachHandlers<T>): void {
  const tail = opts.work().then(
    (value) => opts.onFinish(value).catch(() => undefined),
    (err) => opts.onError(err).catch(() => undefined),
  );

  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(tail);
  } else {
    // Test environments lack waitUntil; keep a reference so an unhandled
    // rejection doesn't terminate the process.
    void tail;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test:edge`
Expected: PASS (all three `runDetached` tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/import-runner.ts supabase/functions/_shared/import-runner.test.ts
git commit -m "feat(edge): add runDetached always-background import helper"
```

---

## Task 2: `import-url` always-background

**Files:**
- Modify: `supabase/functions/import-url/index.ts`

- [ ] **Step 1: Swap the import** at the top.

Change:
```ts
import { runWithBackgroundDetach } from '../_shared/import-runner.ts';
```
to:
```ts
import { runDetached } from '../_shared/import-runner.ts';
```

- [ ] **Step 2: Drop `mode` from `onFinish`** and always write `awaiting_save` on success.

Replace the `onFinish` signature line:
```ts
    const onFinish = async (value: WorkResult, mode: 'sync' | 'background'): Promise<void> => {
```
with:
```ts
    const onFinish = async (value: WorkResult): Promise<void> => {
```
and replace:
```ts
      const terminalStatus = mode === 'sync' ? 'done' : 'awaiting_save';
      await callerClient
        .from('import_jobs')
        .update({
          status: terminalStatus,
```
with:
```ts
      await callerClient
        .from('import_jobs')
        .update({
          status: 'awaiting_save',
```

- [ ] **Step 3: Replace the detach call + all post-detach branching** with an immediate 202.

Replace this whole block (from `const detach = await runWithBackgroundDetach...` through the final synchronous `return jsonResponse({ job_id: jobId, draft: value.draft, ... }, 200, cors);`):
```ts
    const detach = await runWithBackgroundDetach<WorkResult>({
      firstResponseMs: FIRST_RESPONSE_MS,
      work,
      onFinish,
      onError,
    });

    if (detach.mode === 'background') {
      log({
        request_id: requestId,
        profile_id: caller.profileId,
        household_id: body.household_id,
        function: 'import-url',
        event: 'background.detach',
      });
      return jsonResponse(
        { job_id: jobId, status: 'running', request_id: requestId },
        202,
        cors,
      );
    }

    const value = detach.value;
    if (!value.ok) {
      if (value.reason === 'rate_limit') {
        return jsonResponse(
          { error: 'rate_limit', retry_after: 60, request_id: requestId },
          429,
          cors,
        );
      }
      if (value.reason === 'upstream') {
        // Transient model/API failure — not a content problem. 503 so the SPA
        // surfaces "importer busy, try again" rather than the needs_review
        // "edit the draft" copy.
        return jsonResponse(
          { error: 'upstream', request_id: requestId },
          503,
          cors,
        );
      }
      return jsonResponse(
        {
          job_id: jobId,
          draft: null,
          needs_review: true,
          reason: value.reason,
          request_id: requestId,
        },
        200,
        cors,
      );
    }

    return jsonResponse(
      { job_id: jobId, draft: value.draft, needs_review: false, request_id: requestId },
      200,
      cors,
    );
```
with:
```ts
    // Always detach: the worker runs post-response via waitUntil and writes the
    // terminal status; the SPA's realtime listener saves the draft. Respond 202
    // immediately so the import never blocks the page.
    runDetached<WorkResult>({ work, onFinish, onError });
    log({
      request_id: requestId,
      profile_id: caller.profileId,
      household_id: body.household_id,
      function: 'import-url',
      event: 'background.detach',
    });
    return jsonResponse(
      { job_id: jobId, status: 'running', request_id: requestId },
      202,
      cors,
    );
```

- [ ] **Step 4: Remove the now-unused `FIRST_RESPONSE_MS` constant.**

Delete the line:
```ts
const FIRST_RESPONSE_MS = 10_000;
```

- [ ] **Step 5: Typecheck the edge function**

Run: `pnpm test:edge`
Expected: PASS (existing `import-url/_test.ts` still passes; no type errors from the worker file when Deno loads it).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/import-url/index.ts
git commit -m "feat(edge): import-url detaches to background immediately"
```

---

## Task 3: `import-instagram` always-background

**Files:**
- Modify: `supabase/functions/import-instagram/index.ts`

- [ ] **Step 1: Swap the import.**

Change `import { runWithBackgroundDetach } from '../_shared/import-runner.ts';` to `import { runDetached } from '../_shared/import-runner.ts';`

- [ ] **Step 2: Drop `mode` from `onFinish`.** Replace:
```ts
    const onFinish = async (value: WorkResult, mode: 'sync' | 'background'): Promise<void> => {
```
with `const onFinish = async (value: WorkResult): Promise<void> => {`, and replace:
```ts
      const terminalStatus = mode === 'sync' ? 'done' : 'awaiting_save';
      await callerClient
        .from('import_jobs')
        .update({
          status: terminalStatus,
```
with:
```ts
      await callerClient
        .from('import_jobs')
        .update({
          status: 'awaiting_save',
```

- [ ] **Step 3: Replace the detach call + post-detach branching** (from `const detach = await runWithBackgroundDetach...` through the final `return jsonResponse({ job_id: jobId, draft: value.draft, needs_review: false, thumbnail_url: ... }, 200, cors);`) with:
```ts
    runDetached<WorkResult>({ work, onFinish, onError });
    emit('background.detach');
    return jsonResponse(
      { job_id: jobId, status: 'running', request_id: requestId },
      202,
      cors,
    );
```
This deletes the `if (detach.mode === 'background')` block, the `rate_limit` 429 branch, the `instagram_unavailable` `throw new HttpError(422, ...)` branch, the `upstream` 503 branch, the `needs_review` 200 branch, and the success 200 branch. The `instagram_unavailable` and `rate_limit`/`upstream` reasons are already handled by `onFinish` (→ `failed` rows surfaced via realtime).

- [ ] **Step 4: Remove `const FIRST_RESPONSE_MS = 10_000;`.**

- [ ] **Step 5: Typecheck.** Run: `pnpm test:edge` — Expected: PASS (`import-instagram/_test.ts` unaffected; no type errors).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/import-instagram/index.ts
git commit -m "feat(edge): import-instagram detaches to background immediately"
```

---

## Task 4: `import-photo` always-background

**Files:**
- Modify: `supabase/functions/import-photo/index.ts`

- [ ] **Step 1: Swap the import** to `import { runDetached } from '../_shared/import-runner.ts';`

- [ ] **Step 2: Drop `mode` from `onFinish`.** Replace `const onFinish = async (value: WorkResult, mode: 'sync' | 'background'): Promise<void> => {` with `const onFinish = async (value: WorkResult): Promise<void> => {`, and replace:
```ts
      const terminalStatus = mode === 'sync' ? 'done' : 'awaiting_save';
      await callerClient
        .from('import_jobs')
        .update({
          status: terminalStatus,
```
with:
```ts
      await callerClient
        .from('import_jobs')
        .update({
          status: 'awaiting_save',
```

- [ ] **Step 3: Replace the detach call + post-detach branching** (from `const detach = await runWithBackgroundDetach...` through the final success `return jsonResponse({ job_id: jobId, draft: value.draft, needs_review: false, request_id: requestId }, 200, cors);`) with:
```ts
    runDetached<WorkResult>({ work, onFinish, onError });
    log({
      request_id: requestId,
      profile_id: caller.profileId,
      household_id: body.household_id,
      function: 'import-photo',
      event: 'background.detach',
    });
    return jsonResponse(
      { job_id: jobId, status: 'running', request_id: requestId },
      202,
      cors,
    );
```

- [ ] **Step 4: Remove `const FIRST_RESPONSE_MS = 10_000;`.**

- [ ] **Step 5: Typecheck.** Run: `pnpm test:edge` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/import-photo/index.ts
git commit -m "feat(edge): import-photo detaches to background immediately"
```

---

## Task 5: Remove dead `runWithBackgroundDetach`

**Files:**
- Modify: `supabase/functions/_shared/import-runner.ts`

- [ ] **Step 1: Confirm no remaining references.**

Run: `git grep -n runWithBackgroundDetach -- supabase`
Expected: no matches (all three callers migrated in Tasks 2–4).

- [ ] **Step 2: Delete the `runWithBackgroundDetach` function and its `DetachMode`/`DetachResult`/`DetachOptions` types** from `import-runner.ts`, leaving only `runDetached` + `DetachHandlers` (and the `EdgeRuntime` declaration). (If Task 1 already replaced the whole file with only `runDetached`, this task is a no-op — verify and skip.)

- [ ] **Step 3: Run edge tests.** Run: `pnpm test:edge` — Expected: PASS.

- [ ] **Step 4: Commit (skip if no-op)**

```bash
git add supabase/functions/_shared/import-runner.ts
git commit -m "refactor(edge): drop unused runWithBackgroundDetach"
```

---

## Task 6: i18n — add queue + pop-up strings

**Files:**
- Modify: `src/lib/i18n.en.ts` (inside the `import: { ... }` object, before the closing `}` near line 433)
- Modify: `src/lib/i18n.de.ts` (same `import` block — match keys exactly)

- [ ] **Step 1: Add these keys to the `import` block in `i18n.en.ts`:**

```ts
    started_toast_title: 'Import started',
    started_toast_body: "We'll add it to your collection when it's ready.",
    queue_heading: 'Imports in progress',
    queue_status_queued: 'Queued',
    queue_status_done: 'Imported',
    queue_status_needs_review: 'Needs a second look',
    queue_status_failed: 'Import failed',
    queue_source_photo: 'Photo import',
    queue_source_instagram: 'Instagram post',
    queue_dismiss: 'Dismiss',
    queue_dismiss_aria: 'Dismiss {{source}}',
    away_ready_title: 'Ready while you were away',
    away_ready_body: "'{{title}}' finished importing.",
    away_summary_title: 'Imports finished while you were away',
    away_summary_done: '{{count}} recipe(s) imported.',
    away_summary_failed: "{{count}} import(s) couldn't be finished.",
```

- [ ] **Step 2: Add the same keys (German values) to `i18n.de.ts`.** Use these translations:

```ts
    started_toast_title: 'Import gestartet',
    started_toast_body: 'Wir fügen es deiner Sammlung hinzu, sobald es fertig ist.',
    queue_heading: 'Laufende Importe',
    queue_status_queued: 'In Warteschlange',
    queue_status_done: 'Importiert',
    queue_status_needs_review: 'Muss geprüft werden',
    queue_status_failed: 'Import fehlgeschlagen',
    queue_source_photo: 'Foto-Import',
    queue_source_instagram: 'Instagram-Beitrag',
    queue_dismiss: 'Ausblenden',
    queue_dismiss_aria: '{{source}} ausblenden',
    away_ready_title: 'Fertig, während du weg warst',
    away_ready_body: '„{{title}}“ wurde importiert.',
    away_summary_title: 'Importe abgeschlossen, während du weg warst',
    away_summary_done: '{{count}} Rezept(e) importiert.',
    away_summary_failed: '{{count}} Import(e) konnten nicht abgeschlossen werden.',
```

- [ ] **Step 3: Typecheck** (both locale objects must have identical key shapes).

Run: `pnpm typecheck`
Expected: PASS. If it fails with a key-mismatch error, the en/de objects diverged — reconcile.

- [ ] **Step 4: Commit**

```bash
git add src/lib/i18n.en.ts src/lib/i18n.de.ts
git commit -m "i18n: add import queue + reopen pop-up strings"
```

---

## Task 7: Provider — add `sourceUrl` + expand failed-code mapping

**Files:**
- Modify: `src/lib/imports/ActiveImportsProvider.tsx`

- [ ] **Step 1: Add `sourceUrl` to the `ActiveImport` type.** After the `recipeId: string | null;` line in `ActiveImport`, add:
```ts
  sourceUrl: string | null;
```

- [ ] **Step 2: Populate it in `rowToActive`.** In the returned object add (after `recipeId: ...`):
```ts
    sourceUrl: (row.payload as { url?: string } | null | undefined)?.url ?? null,
```

- [ ] **Step 3: Add `sourceUrl` to `RegisterArgs`** and the optimistic insert. Change `RegisterArgs` to:
```ts
type RegisterArgs = {
  jobId: string;
  householdId: string;
  kind: ImportKind;
  sourceUrl?: string | null;
};
```
In `register`, accept it and set it on the optimistic object:
```ts
  const register = useCallback(
    ({ jobId, householdId, kind, sourceUrl }: RegisterArgs) => {
```
and in the optimistic `ActiveImport` add `sourceUrl: sourceUrl ?? null,` (after `recipeId: null,`).

- [ ] **Step 4: Expand the failed-code mapping** so background `failed` rows show specific copy. Replace:
```ts
const KNOWN_FAILED_CODES = new Set(['rate_limit', 'upstream', 'timeout']);
```
with:
```ts
// Server `error` codes that have a dedicated user-facing i18n string under
// `errors.*`. With every import now finishing in the background, more failure
// reasons reach the SPA via realtime instead of as a synchronous HTTP error,
// so map all of them. Anything unknown falls back to errors.internal.
const KNOWN_FAILED_CODES = new Set([
  'rate_limit',
  'upstream',
  'timeout',
  'fetch_failed',
  'invalid_url',
  'not_html',
  'source_too_large',
  'instagram_unavailable',
  'object_not_found',
  'forbidden_path',
  'not_image',
  'photo_too_large',
  'network',
]);
```

- [ ] **Step 5: Typecheck.** Run: `pnpm typecheck` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/imports/ActiveImportsProvider.tsx
git commit -m "feat(imports): track sourceUrl + map all background failure codes"
```

---

## Task 8: Provider — reopen pop-up (high-water-mark + terminal backfill)

**Files:**
- Modify: `src/lib/imports/ActiveImportsProvider.tsx`
- Test: `src/lib/imports/ActiveImportsProvider.test.tsx` (new)

This adds a `localStorage` high-water-mark of the most recent terminal completion already announced, surfaces newer terminal rows on mount as a persistent pop-up, and bumps the mark whenever a live terminal event is seen so a refresh never re-announces.

- [ ] **Step 1: Write the failing test.** Create `src/lib/imports/ActiveImportsProvider.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Minimal pushed-toast capture.
const pushed: Array<{ title: string }> = [];
vi.mock('@/ui/primitives/Toast', () => ({
  useToast: () => ({ push: (t: { title: string }) => pushed.push(t) }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => () => {} }));
vi.mock('@/lib/auth', () => ({ useAuth: (sel: (s: unknown) => unknown) => sel({ profile: { id: 'p1' } }) }));

// Supabase mock: a query builder that resolves to `terminalRows` for the
// terminal backfill and [] otherwise; a no-op realtime channel.
let terminalRows: unknown[] = [];
vi.mock('@/lib/supabase', () => {
  const builder = () => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order', 'update']) b[m] = () => b;
    // `.gt('completed_at', ...)` marks the terminal-backfill query.
    b.gt = () => ({ then: (r: (v: { data: unknown[] }) => void) => r({ data: terminalRows }) });
    // live-rows query resolves to empty
    (b.order as () => unknown) = () => Promise.resolve({ data: [] });
    return b;
  };
  return {
    supabase: {
      from: () => builder(),
      rpc: () => Promise.resolve({ data: null, error: null }),
      channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
      removeChannel: () => {},
    },
  };
});

import { ActiveImportsProvider } from './ActiveImportsProvider';

beforeEach(() => {
  pushed.length = 0;
  terminalRows = [];
  localStorage.clear();
});
afterEach(() => vi.clearAllMocks());

describe('ActiveImportsProvider reopen pop-up', () => {
  it('announces a terminal import that completed past the stored mark', async () => {
    localStorage.setItem('dishton:imports:lastNotified:p1', '2026-06-01T00:00:00.000Z');
    terminalRows = [
      {
        id: 'j1',
        household_id: 'h1',
        kind: 'url',
        status: 'done',
        recipe_id: 'r1',
        payload: { url: 'https://x.test/a', draft: { title: 'Tarte' } },
        error: null,
        created_at: '2026-06-02T00:00:00.000Z',
        completed_at: '2026-06-02T00:00:00.000Z',
      },
    ];
    render(<ActiveImportsProvider><div /></ActiveImportsProvider>);
    await waitFor(() => expect(pushed.some((t) => t.title === 'import.away_ready_title')).toBe(true));
    // mark advanced to the row's completed_at
    expect(localStorage.getItem('dishton:imports:lastNotified:p1')).toBe('2026-06-02T00:00:00.000Z');
  });

  it('does not announce when nothing is newer than the mark', async () => {
    localStorage.setItem('dishton:imports:lastNotified:p1', '2026-06-09T00:00:00.000Z');
    terminalRows = [];
    render(<ActiveImportsProvider><div /></ActiveImportsProvider>);
    await waitFor(() => expect(true).toBe(true));
    expect(pushed.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm vitest run src/lib/imports/ActiveImportsProvider.test.tsx`
Expected: FAIL — no pop-up is pushed (the terminal backfill doesn't exist yet).

- [ ] **Step 3: Implement the high-water-mark + terminal backfill.** In `ActiveImportsProvider.tsx`, add a module-level helper near the top (after `COMPLETED_TTL_MS`):

```ts
function lastNotifiedKey(profileId: string): string {
  return `dishton:imports:lastNotified:${profileId}`;
}

function draftTitle(row: Row): string | null {
  const draft = (row.payload as { draft?: { title?: string } } | null | undefined)?.draft;
  return draft?.title ?? null;
}
```

Then add a `bumpMark` callback inside the component (after `dismiss`):

```ts
  // Advance the per-device high-water-mark so a reopen never re-announces a
  // terminal import the user already saw (live or via a prior backfill).
  const bumpMark = useCallback(
    (completedAt: string | null | undefined) => {
      if (!profileId || !completedAt) return;
      const key = lastNotifiedKey(profileId);
      const prev = localStorage.getItem(key);
      if (!prev || completedAt > prev) localStorage.setItem(key, completedAt);
    },
    [profileId],
  );
```

Add an `announceAway` callback (after `saveFromAwaiting`):

```ts
  // Surface terminal imports that completed while this device wasn't listening,
  // as a persistent pop-up on reopen. `done` rows link to the recipe; failures
  // are summarised.
  const announceAway = useCallback(
    (rows: Row[]) => {
      const done = rows.filter((r) => r.status === 'done' && r.recipe_id);
      const failed = rows.filter((r) => r.status === 'failed' || r.status === 'needs_review');
      if (done.length === 1 && failed.length === 0) {
        const row = done[0];
        const title = draftTitle(row) ?? '';
        push({
          variant: 'success',
          persist: true,
          title: t('import.away_ready_title'),
          description: (
            <button
              type="button"
              className="underline"
              onClick={() =>
                navigate({
                  to: '/h/$householdId/r/$recipeId',
                  params: { householdId: row.household_id, recipeId: row.recipe_id as string },
                })
              }
            >
              {title ? t('import.away_ready_body', { title }) : t('import.ready_view_recipe')}
            </button>
          ),
        });
        return;
      }
      if (done.length === 0 && failed.length === 0) return;
      push({
        variant: failed.length > 0 && done.length === 0 ? 'error' : 'info',
        persist: true,
        title: t('import.away_summary_title'),
        description: [
          done.length > 0 ? t('import.away_summary_done', { count: done.length }) : null,
          failed.length > 0 ? t('import.away_summary_failed', { count: failed.length }) : null,
        ]
          .filter(Boolean)
          .join(' '),
      });
    },
    [navigate, push, t],
  );
```

In the mount `useEffect`, **after** the existing live-rows backfill IIFE block (after the `for (const r of data...)` loop that calls `upsert`/`saveFromAwaiting`), add a terminal backfill inside the same `void (async () => { ... })()`:

```ts
      // Reopen pop-up: announce terminal imports completed past the mark.
      const markKey = lastNotifiedKey(profileId);
      let mark = localStorage.getItem(markKey);
      if (mark === null) {
        // First run on this device: establish the mark at "now" so we never
        // replay the user's whole import history.
        mark = new Date().toISOString();
        localStorage.setItem(markKey, mark);
      }
      const { data: terminal } = await supabase
        .from('import_jobs')
        .select(
          'id, household_id, kind, status, phase, progress_text, recipe_id, payload, error, created_at, completed_at',
        )
        .eq('profile_id', profileId)
        .in('status', ['done', 'failed', 'needs_review'])
        .gt('completed_at', mark)
        .order('completed_at', { ascending: true });
      if (cancelled || !terminal || terminal.length === 0) return;
      for (const r of terminal as Row[]) upsert(r, 'realtime');
      announceAway(terminal as Row[]);
      const newest = (terminal as Row[])[terminal.length - 1]?.completed_at;
      if (newest) localStorage.setItem(markKey, newest);
```

In the realtime handler, bump the mark for any terminal event so a later refresh won't re-announce. Inside the `.on('postgres_changes', ..., (payload) => { ... })` callback, after `upsert(row, 'realtime');`, add:

```ts
          if (row.status === 'done' || row.status === 'failed' || row.status === 'needs_review') {
            bumpMark(row.completed_at);
          }
```

Update the `useEffect` dependency array to include `announceAway` and `bumpMark`.

- [ ] **Step 4: Run the test to verify it passes.**

Run: `pnpm vitest run src/lib/imports/ActiveImportsProvider.test.tsx`
Expected: PASS (both cases).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm typecheck` — Expected: PASS.
```bash
git add src/lib/imports/ActiveImportsProvider.tsx src/lib/imports/ActiveImportsProvider.test.tsx
git commit -m "feat(imports): announce while-you-were-away completions on reopen"
```

---

## Task 9: `ImportQueue` presentational component

**Files:**
- Create: `src/ui/recipe/ImportQueue.tsx`
- Test: `src/ui/recipe/ImportQueue.test.tsx`

Pure component: takes already-filtered `items`, `onDismiss`, `onView`. No hooks beyond `useTranslation`. Mirrors the prop-driven style of `ChatHistorySidebar`.

- [ ] **Step 1: Write the failing test.** Create `src/ui/recipe/ImportQueue.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import type { ActiveImport } from '@/lib/imports/ActiveImportsProvider';
import { ImportQueue } from './ImportQueue';

const base: ActiveImport = {
  jobId: 'j1',
  householdId: 'h1',
  kind: 'url',
  status: 'running',
  phase: 'ai',
  progressText: null,
  recipeId: null,
  sourceUrl: 'https://smittenkitchen.com/tart',
  origin: 'this-tab',
  createdAt: '2026-06-07T00:00:00Z',
  completedAt: null,
};

const noop = () => {};

describe('ImportQueue', () => {
  it('renders nothing when there are no items', () => {
    const { container } = render(<ImportQueue items={[]} onDismiss={noop} onView={noop} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the source host and the running phase label', () => {
    render(<ImportQueue items={[base]} onDismiss={noop} onView={noop} />);
    expect(screen.getByText('smittenkitchen.com')).toBeInTheDocument();
    expect(screen.getByText('import.phase_ai')).toBeInTheDocument();
  });

  it('shows a photo source label for photo imports', () => {
    render(
      <ImportQueue
        items={[{ ...base, kind: 'photo', sourceUrl: null }]}
        onDismiss={noop}
        onView={noop}
      />,
    );
    expect(screen.getByText('import.queue_source_photo')).toBeInTheDocument();
  });

  it('fires onView for a done import', () => {
    const onView = vi.fn();
    render(
      <ImportQueue
        items={[{ ...base, status: 'done', phase: null, recipeId: 'r9' }]}
        onDismiss={noop}
        onView={onView}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'import.ready_view_recipe' }));
    expect(onView).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'j1', recipeId: 'r9' }));
  });

  it('shows the error message for a failed import and dismisses', () => {
    const onDismiss = vi.fn();
    render(
      <ImportQueue
        items={[{ ...base, status: 'failed', phase: null }]}
        onDismiss={onDismiss}
        onView={noop}
      />,
    );
    expect(screen.getByText('import.queue_status_failed')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('import.queue_dismiss_aria'));
    expect(onDismiss).toHaveBeenCalledWith('j1');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm vitest run src/ui/recipe/ImportQueue.test.tsx`
Expected: FAIL — `./ImportQueue` does not exist.

- [ ] **Step 3: Implement `src/ui/recipe/ImportQueue.tsx`:**

```tsx
import type { ActiveImport } from '@/lib/imports/ActiveImportsProvider';
import { cn } from '@/ui/cn';
import { Camera, CheckCircle2, Globe, Instagram, Loader, TriangleAlert, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const PHASE_LABEL_KEYS = {
  scrape: 'import.phase_scrape',
  ai: 'import.phase_ai',
  saving: 'import.phase_saving',
} as const;

const KIND_ICON = { url: Globe, instagram: Instagram, photo: Camera, manual: Globe } as const;

function isActive(status: ActiveImport['status']): boolean {
  return status === 'queued' || status === 'running' || status === 'awaiting_save';
}

function sourceLabel(item: ActiveImport, t: (k: string) => string): string {
  if (item.kind === 'photo') return t('import.queue_source_photo');
  if (item.sourceUrl) {
    try {
      return new URL(item.sourceUrl).hostname.replace(/^www\./, '');
    } catch {
      return item.sourceUrl;
    }
  }
  if (item.kind === 'instagram') return t('import.queue_source_instagram');
  return t('import.phase_default');
}

function statusLabel(item: ActiveImport, t: (k: string) => string): string {
  switch (item.status) {
    case 'queued':
      return t('import.queue_status_queued');
    case 'running':
    case 'awaiting_save':
      return item.phase ? t(PHASE_LABEL_KEYS[item.phase]) : t('import.phase_default');
    case 'done':
      return t('import.queue_status_done');
    case 'needs_review':
      return t('import.queue_status_needs_review');
    case 'failed':
      return t('import.queue_status_failed');
  }
}

export function ImportQueue({
  items,
  onDismiss,
  onView,
}: {
  items: ActiveImport[];
  onDismiss: (jobId: string) => void;
  onView: (item: ActiveImport) => void;
}) {
  const { t } = useTranslation();
  if (items.length === 0) return null;

  return (
    <section className="mt-6" aria-label={t('import.queue_heading')}>
      <h2 className="font-display text-lg mb-2">{t('import.queue_heading')}</h2>
      <ul className="space-y-2">
        {items.map((item) => {
          const Icon = KIND_ICON[item.kind];
          const active = isActive(item.status);
          const source = sourceLabel(item, t);
          return (
            <li
              key={item.jobId}
              className="flex items-center gap-3 rounded-[var(--radius-md)] border border-ink/10 bg-paper px-3 py-2"
            >
              <Icon size={18} strokeWidth={1.75} className="shrink-0 text-ink-soft" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink">{source}</p>
                <p
                  className={cn(
                    'flex items-center gap-1.5 text-xs',
                    item.status === 'failed' ? 'text-pomegranate' : 'text-ink-soft',
                  )}
                >
                  {active && <Loader size={12} strokeWidth={1.75} className="animate-spin" aria-hidden />}
                  {item.status === 'done' && (
                    <CheckCircle2 size={12} strokeWidth={1.75} className="text-basil" aria-hidden />
                  )}
                  {(item.status === 'failed' || item.status === 'needs_review') && (
                    <TriangleAlert size={12} strokeWidth={1.75} aria-hidden />
                  )}
                  {statusLabel(item, t)}
                </p>
              </div>
              {item.status === 'done' && item.recipeId && (
                <button
                  type="button"
                  className="shrink-0 text-xs text-aubergine underline"
                  onClick={() => onView(item)}
                >
                  {t('import.ready_view_recipe')}
                </button>
              )}
              {!active && (
                <button
                  type="button"
                  className="shrink-0 rounded p-1 text-ink-muted hover:text-ink"
                  aria-label={t('import.queue_dismiss_aria', { source })}
                  onClick={() => onDismiss(item.jobId)}
                >
                  <X size={14} strokeWidth={2} aria-hidden />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `pnpm vitest run src/ui/recipe/ImportQueue.test.tsx`
Expected: PASS (all five cases).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm typecheck` — Expected: PASS.
```bash
git add src/ui/recipe/ImportQueue.tsx src/ui/recipe/ImportQueue.test.tsx
git commit -m "feat(imports): inline ImportQueue list component"
```

---

## Task 10: Import page — immediate background submit + render the queue

**Files:**
- Modify: `src/routes/h/$householdId/import.tsx`

- [ ] **Step 1: Update imports.** Remove the `ImportProgress` import and add `ImportQueue` + `ActiveImport`/`useActiveImports` (already imported) usage. At the top, delete:
```ts
import { ImportProgress } from '@/ui/recipe/ImportProgress';
```
and add:
```ts
import { ImportQueue } from '@/ui/recipe/ImportQueue';
import type { ActiveImport } from '@/lib/imports/ActiveImportsProvider';
```
Change the `useActiveImports` import to also pull `dismiss`:
```ts
import { useActiveImports } from '@/lib/imports/ActiveImportsProvider';
```
(kept — both `register` and now `dismiss` come from it).

- [ ] **Step 2: Rename the timeout constant.** Replace:
```ts
const IMPORT_URL_TIMEOUT_MS = 120_000;
```
with:
```ts
// Only the kickoff round-trip is awaited now (the worker runs in the
// background), so this guards a hung/cold-start invoke, not the whole import.
const IMPORT_KICKOFF_TIMEOUT_MS = 30_000;
```

- [ ] **Step 3: Render the queue panel in `ImportPage`.** Replace the `ImportPage` component body's `<Tabs>...</Tabs>` closing with the tabs followed by the panel:

```tsx
function ImportPage() {
  const { householdId } = Route.useParams();
  const { t } = useTranslation();

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="font-display text-3xl mb-6">{t('nav.import')}</h1>
      <Tabs defaultValue="url">
        <TabsList>
          <TabsTrigger value="url">{t('import.tab_url')}</TabsTrigger>
          <TabsTrigger value="photo">{t('import.tab_photo')}</TabsTrigger>
          <TabsTrigger value="manual">{t('import.tab_manual')}</TabsTrigger>
        </TabsList>
        <TabsContent value="url">
          <UrlTab householdId={householdId} />
        </TabsContent>
        <TabsContent value="photo">
          <PhotoTab householdId={householdId} />
        </TabsContent>
        <TabsContent value="manual">
          <ManualTab />
        </TabsContent>
      </Tabs>
      <ImportQueuePanel householdId={householdId} />
    </main>
  );
}

function ImportQueuePanel({ householdId }: { householdId: string }) {
  const { items, dismiss } = useActiveImports();
  const navigate = useNavigate({ from: Route.fullPath });
  const householdItems = items.filter((it) => it.householdId === householdId);
  const onView = (item: ActiveImport): void => {
    if (!item.recipeId) return;
    void navigate({
      to: '/h/$householdId/r/$recipeId',
      params: { householdId, recipeId: item.recipeId },
    });
  };
  return <ImportQueue items={householdItems} onDismiss={dismiss} onView={onView} />;
}
```

- [ ] **Step 4: Replace the `UrlTab` submit handler + remove the background machinery.** In `UrlTab`, delete `backgroundedRef`, `abortRef`, `dispatchToBackground`, and the `<ImportProgress .../>` line. Pull `dismiss` is not needed here. The component becomes:

```tsx
function UrlTab({ householdId }: { householdId: string }) {
  const { t } = useTranslation();
  const { push } = useToast();
  const { register: registerImport } = useActiveImports();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ImportUrlInput>({ resolver: zodResolver(ImportUrlSchema) });

  return (
    <Card className="mt-4 p-6">
      <form
        className="space-y-3"
        onSubmit={handleSubmit(async (values) => {
          const source = detectImportSource(values.url);
          const fnName = source === 'instagram' ? 'import-instagram' : 'import-url';
          const kind: ImportKindLocal = source === 'instagram' ? 'instagram' : 'url';
          bcImportStart(source);
          bcImportInputValidated({ url_length: values.url.length, source });
          const t0 = performance.now();
          bcImportRequestSent(fnName, '');
          const ac = new AbortController();
          const timer = setTimeout(() => ac.abort(), IMPORT_KICKOFF_TIMEOUT_MS);
          let invokeError: unknown = null;
          let data: unknown = null;
          try {
            const result = await supabase.functions.invoke(fnName, {
              body: { url: values.url, household_id: householdId },
              signal: ac.signal,
            });
            invokeError = result.error;
            data = result.data;
          } catch (e) {
            invokeError = e;
          } finally {
            clearTimeout(timer);
          }
          bcImportResponseReceived(Math.round(performance.now() - t0), invokeError ? 500 : 202);
          if (invokeError) {
            const code = await readErrorCode(invokeError);
            push({
              variant: 'error',
              title: t('import.error_title'),
              description: t(`errors.${code}`),
            });
            return;
          }
          const payload = data as DraftResponse | null;
          if (payload?.job_id) {
            registerImport({ jobId: payload.job_id, householdId, kind, sourceUrl: values.url });
          }
          push({
            variant: 'info',
            title: t('import.started_toast_title'),
            description: t('import.started_toast_body'),
          });
          reset();
        })}
      >
        <Input placeholder={t('import.url_placeholder')} {...register('url')} />
        {errors.url && <p className="text-pomegranate text-sm">{errors.url.message}</p>}
        <div
          className="flex items-center gap-2 text-ink-soft text-xs"
          aria-label={t('import.supported_sources_label')}
        >
          <span>{t('import.supported_sources_label')}</span>
          <Globe className="size-4" aria-hidden="true" />
          <Instagram className="size-4" aria-hidden="true" />
        </div>
        <Button type="submit" loading={isSubmitting} disabled={isSubmitting}>
          {t('import.submit')}
        </Button>
      </form>
    </Card>
  );
}
```

- [ ] **Step 5: Replace the `PhotoTab` submit tail** (keep the file-picker UI + upload logic; only change the post-upload invoke handling + remove background machinery). Delete `backgroundedRef`, `abortRef`, `dispatchToBackground`, and the `<ImportProgress .../>` line. Replace the invoke-and-after section (from `const t0 = performance.now();` through the end of the submit handler) with:

```tsx
          const t0 = performance.now();
          bcImportRequestSent('import-photo', '');
          const ac = new AbortController();
          const timer = setTimeout(() => ac.abort(), IMPORT_KICKOFF_TIMEOUT_MS);
          let invokeError: unknown = null;
          let data: unknown = null;
          try {
            const result = await supabase.functions.invoke('import-photo', {
              body: {
                household_id: householdId,
                paths,
                ...(trimmedComment ? { comment: trimmedComment } : {}),
              },
              signal: ac.signal,
            });
            invokeError = result.error;
            data = result.data;
          } catch (e) {
            invokeError = e;
          } finally {
            clearTimeout(timer);
          }
          bcImportResponseReceived(Math.round(performance.now() - t0), invokeError ? 500 : 202);
          if (invokeError) {
            const code = await readErrorCode(invokeError);
            push({
              variant: 'error',
              title: t('import.error_title'),
              description: t(`errors.${code}`),
            });
            return;
          }
          const payload = data as DraftResponse | null;
          if (payload?.job_id) {
            registerImport({ jobId: payload.job_id, householdId, kind: 'photo' });
          }
          push({
            variant: 'info',
            title: t('import.started_toast_title'),
            description: t('import.started_toast_body'),
          });
          reset({ comment: '' });
          setFiles([]);
```

- [ ] **Step 6: Prune now-unused symbols.** In `import.tsx` remove the `DraftResponse` fields that are no longer read (`draft`, `needs_review`, `reason`) — keep `job_id` and `status`:
```ts
type DraftResponse = {
  job_id?: string;
  status?: 'running';
};
```
Remove unused imports: `useQueryClient` and `useRef` if no longer referenced (the URL tab no longer uses refs; PhotoTab still uses `useState`). Keep `useNavigate` (used by `ImportQueuePanel`). Keep `bcImportSaveFailed`? It is no longer used in this file → remove it from the breadcrumbs import. Verify with the typecheck/lint in the next step.

- [ ] **Step 7: Typecheck + lint.**

Run: `pnpm typecheck`
Expected: PASS. Fix any "declared but never read" errors by removing the unused import/local (Biome + `noUnusedLocals`).

Run: `pnpm lint`
Expected: no errors on `src/routes/h/$householdId/import.tsx` (ignore pre-existing whole-repo CRLF noise on Windows; CI on LF is authoritative).

- [ ] **Step 8: Commit**

```bash
git add src/routes/h/$householdId/import.tsx
git commit -m "feat(imports): submit imports straight to background + show queue"
```

---

## Task 11: Delete `ImportProgress` + retire its i18n strings

**Files:**
- Delete: `src/ui/recipe/ImportProgress.tsx`
- Modify: `src/lib/i18n.en.ts`, `src/lib/i18n.de.ts`

- [ ] **Step 1: Confirm `ImportProgress` is unreferenced.**

Run: `git grep -n ImportProgress -- src`
Expected: only `src/ui/recipe/ImportProgress.tsx` itself (Task 10 removed the import-page usage).

- [ ] **Step 2: Delete the component file.**

```bash
git rm src/ui/recipe/ImportProgress.tsx
```

- [ ] **Step 3: Remove the retired keys** from the `import` block in BOTH `i18n.en.ts` and `i18n.de.ts`: `preparing`, `progress_label`, `step_reach`, `step_read`, `step_distill`, `step_plate`, `long_wait_hint`, `background_button`, `background_toast_title`, `background_toast_body`. (Keep `ready_title`, `ready_view_recipe`, `phase_*`, `active_indicator_*`, `success_*`, `error_*`, `needs_review_*`.)

- [ ] **Step 4: Confirm none of the retired keys are still referenced.**

Run: `git grep -nE "import\.(preparing|progress_label|step_reach|step_read|step_distill|step_plate|long_wait_hint|background_button|background_toast_title|background_toast_body)" -- src`
Expected: no matches.

- [ ] **Step 5: Typecheck.** Run: `pnpm typecheck` — Expected: PASS (en/de key shapes still match).

- [ ] **Step 6: Commit**

```bash
git add src/ui/recipe/ImportProgress.tsx src/lib/i18n.en.ts src/lib/i18n.de.ts
git commit -m "chore(imports): remove ImportProgress + retire its strings"
```

---

## Task 12: Nav pill links to the import page

**Files:**
- Modify: `src/ui/shell/ActiveImportsIndicator.tsx`
- Read first: `src/ui/shell/AppShell.tsx` (to learn how the current household id is available to the shell)

- [ ] **Step 1: Read `AppShell.tsx`** to find how it obtains the active `householdId` (route params, a store, or a context). If a household id is readily available there, pass it into `<ActiveImportsIndicator householdId={...} />`; if not, derive it inside the indicator from the newest item (`active[0].householdId`) — every active import carries one.

- [ ] **Step 2: Wrap the pill in a TanStack `Link`** to the import page, using the newest active import's household id (no new prop needed):

```tsx
import { useActiveImports } from '@/lib/imports/ActiveImportsProvider';
import { cn } from '@/ui/cn';
import { Link } from '@tanstack/react-router';
import { Loader } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const PHASE_LABEL_KEYS = {
  scrape: 'import.phase_scrape',
  ai: 'import.phase_ai',
  saving: 'import.phase_saving',
} as const;

export function ActiveImportsIndicator() {
  const { items } = useActiveImports();
  const { t } = useTranslation();
  const active = items.filter(
    (it) => it.status === 'queued' || it.status === 'running' || it.status === 'awaiting_save',
  );
  const newest = active[0];
  if (!newest) return null;
  const phaseKey = newest.phase ? PHASE_LABEL_KEYS[newest.phase] : null;
  const phaseLabel = phaseKey ? t(phaseKey) : t('import.phase_default');
  return (
    <Link
      to="/h/$householdId/import"
      params={{ householdId: newest.householdId }}
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[var(--radius-pill)]',
        'bg-saffron/15 text-aubergine text-xs font-body hover:bg-saffron/25',
      )}
      role="status"
      aria-live="polite"
      title={t('import.active_indicator_tooltip', { count: active.length })}
    >
      <Loader size={14} strokeWidth={1.75} className="animate-spin" />
      <span className="hidden sm:inline">
        {active.length === 1
          ? phaseLabel
          : t('import.active_indicator_count', { count: active.length })}
      </span>
      <span className="sm:hidden font-medium">{active.length}</span>
    </Link>
  );
}
```

- [ ] **Step 3: Typecheck.** Run: `pnpm typecheck` — Expected: PASS. (If the `to`/`params` types complain, confirm the route id string matches the generated route — it is `/h/$householdId/import`.)

- [ ] **Step 4: Commit**

```bash
git add src/ui/shell/ActiveImportsIndicator.tsx
git commit -m "feat(imports): link the active-imports pill to the import page"
```

---

## Task 13: Full verification + visual validation

**Files:** none (verification only).

- [ ] **Step 1: Typecheck.** Run: `pnpm typecheck` — Expected: PASS.

- [ ] **Step 2: Lint changed files.** Run: `pnpm lint` — Expected: no errors on changed files (Windows CRLF whole-repo noise is expected; CI on LF is authoritative — see memory `windows-crlf-biome-lint`).

- [ ] **Step 3: Unit + component tests.** Run: `pnpm test:components` and `pnpm test:unit` — Expected: PASS, including the new `ImportQueue.test.tsx` and `ActiveImportsProvider.test.tsx`.

- [ ] **Step 4: Edge tests.** Run: `pnpm test:edge` — Expected: PASS, including `runDetached` tests.

- [ ] **Step 5: Visual validation (REQUIRED).** Invoke the `validating-features-visually` skill and follow it exactly. Because the sandbox stack runs **without** edge functions, exercise the UI by **seeding `import_jobs` rows directly** (per CLAUDE.md's RLS-only guidance):
  - Sign up / sign in via the skill's flow; capture the resulting `profile_id` + a `household_id`.
  - Seed rows on `app.import_jobs` to cover: a `running`/`phase=ai` row, an `awaiting_save` row, a `done` row with `recipe_id` + `payload.draft.title`, and a `failed` row with `error='fetch_failed'`.
  - Navigate to `/h/<householdId>/import` → screenshot the **inline ImportQueue** at desktop (1280px) and mobile (390px). Verify: source host, state labels + spinner/check/alert icons, View-recipe link on the done row, Dismiss on terminal rows, no mobile overflow.
  - **Reopen pop-up:** set `localStorage['dishton:imports:lastNotified:<profileId>']` to a timestamp *before* the seeded `done`/`failed` `completed_at`, reload, and screenshot the persistent "while you were away" toast.
  - **Submit optimism:** with `functions.invoke` stubbed to resolve `{ data: { job_id, status: 'running' } }`, submit a URL → screenshot the cleared form + "Import started" toast + the new queue row.
  - Confirm the nav pill renders while a `running` row exists and links to the import page.

- [ ] **Step 6: Final commit (screenshots/notes if the skill produces any artifacts).**

```bash
git add -A
git commit -m "test(imports): visual validation screenshots for background imports"
```

---

## Self-Review

**Spec coverage:**
- Goal 1 (background immediately) → Tasks 1–5 (edge) + Task 10 (client). ✓
- Goal 2 (see running imports) → Tasks 7 (sourceUrl), 9 (ImportQueue), 10 (render). ✓
- Goal 3 (survive close + reopen pop-up) → Task 8 (high-water-mark + announce). ✓
- Supporting: provider sourceUrl (7), nav pill link (12), i18n add/retire (6, 11), delete ImportProgress (11). ✓
- No migration — confirmed; no task creates one. ✓

**Deviation from spec (intentional):** the spec mentioned per-function HTTP handler tests asserting `202`. The edge functions call `serve(...)` with a non-exported inline handler and depend on `resolveCaller` + a live Supabase client; the existing `_test.ts` files do not test the handler, and adding a handler harness is out of pattern. The behavioral guarantee ("always background, never sync") is instead covered by `runDetached` unit tests (Task 1, incl. "returns before work completes") plus end-to-end visual validation (Task 13). Existing `import-*/_test.ts` files remain green (they only test the AI mock harness).

**Placeholder scan:** no TBD/TODO; every code step shows full code. ✓

**Type consistency:** `ActiveImport.sourceUrl` (Task 7) is consumed by `ImportQueue` (Task 9) and set by `registerImport({ ..., sourceUrl })` (Task 10). `runDetached`/`DetachHandlers` (Task 1) are used in Tasks 2–4. `DraftResponse.job_id` (Task 10) matches the edge `202` body `{ job_id, status }` (Tasks 2–4). i18n keys added in Task 6 (`started_toast_*`, `queue_*`, `away_*`) are referenced in Tasks 8, 9, 10. ✓
