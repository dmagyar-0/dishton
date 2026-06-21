# 08 — Import Pipelines

## Purpose

Specify the four end-to-end recipe-import flows — URL, Instagram, photo,
manual — including the Edge Function entry points, intermediate state of
`import_jobs`, error handling, and user-facing copy. Every flow ends with a
draft Recipe in the editor; only the user's "Save" call writes to
`app.recipes`. Saving is intentionally a separate step so the user always sees
what AI produced before it hits the canonical store.

## Prerequisites

- [00-overview.md](./00-overview.md) — locked import sources.
- [01-architecture.md](./01-architecture.md) — Edge Function topology.
- [04-data-model.md](./04-data-model.md) — `app.import_jobs`, storage buckets.
- [06-recipe-domain.md](./06-recipe-domain.md) — Recipe Zod schema.
- [07-ai-integration.md](./07-ai-integration.md) — Anthropic client and validation.

## Edge Function map

| Function | Path | Purpose |
|---|---|---|
| `import-url` | `/functions/v1/import-url` | Blog / article URL import |
| `import-instagram` | `/functions/v1/import-instagram` | Instagram URL import (direct caption fetch) |
| `import-photo` | `/functions/v1/import-photo` | Photo upload OCR + structuring |
| `translate-recipe` | `/functions/v1/translate-recipe` | View-time translation cache miss |

`manual` has no Edge Function — the SPA writes directly to `app.recipes` via
the Supabase client.

Each function:

1. Reads `Authorization: Bearer <jwt>` and resolves `auth.uid()`.
2. Reads the request body and Zod-validates the input.
3. Inserts an `import_jobs` row with `status='running'`.
4. Calls `withRateBudget` (see
   [07-ai-integration.md](./07-ai-integration.md)).
5. Performs source-specific work, then `callAndValidate`.
6. Updates the job to `done` or `needs_review` or `failed`.
7. Returns the draft Recipe + job id.

The functions never insert into `app.recipes` themselves. The SPA does that
after the user reviews and confirms the draft. This keeps the SPA's optimistic
UI in charge of authoritative writes.

## Flow 1 — URL import

```
[Browser] POST /functions/v1/import-url
          { url, household_id }
[Edge]    auth.uid() → ensure household_id is a member's
          insert import_jobs(status=running, kind=url)
[Edge]    fetch url with allow-list:
            method GET, max 5 MB, ≤3 redirects, 8s connect / 15s read,
            User-Agent "DishtonBot/0.1 (+https://dishton.app)"
            reject non-2xx, non-text/html (image MIME shortcut to import-photo
            disallowed; user must use the photo tab)
[Edge]    JSON-LD scrape + light HTML strip:
            const dom = parseHTML(html);
            const scraped = extractRecipeJsonLd(dom.document);  // Recipe @type only
            const stripped = lightStripHtml(html);              // drops script/style/head/svg
[Edge]    estimatedTokens = 4000
          withRateBudget(profileId, 4000, () =>
            callAndValidate({
              lane: 'text',
              messages: structuringFromHtml({ html: stripped,
                                             sourceUrl: url,
                                             scraped }),
              estimatedTokens: 4000,
            }))
[Edge]    on rate_limit → respond 429 with body
          { error: 'rate_limit', retry_after: <seconds> }
[Edge]    on validate.ok=false → import_jobs.status='needs_review',
          payload.raw_model_output stored, return draft skeleton
          { title: '<unknown>', source_type:'url', source_url: url, ... }
[Edge]    on success → import_jobs.status='done',
          payload = { tokens_in, tokens_out, latency_ms }
          return { job_id, draft, hero_image_url? }
[Browser] open Edit Draft modal pre-filled with draft
[Browser] On Save: insert recipes + recipe_ingredients + recipe_steps +
          recipe_tags inside a single transaction (rpc app.save_recipe(json))
```

`linkedom` provides a Deno-compatible DOM, used for JSON-LD extraction.
The HTML body that's passed to the model goes through `lightStripHtml` —
a string-level strip of `<script>`, `<style>`, `<head>`, `<svg>`,
`<noscript>`, `<picture>`, `<iframe>`, `<template>`, self-closing
`<link>/<meta>/<base>/<source>`, and HTML comments. We deliberately do
NOT use Mozilla Readability: it scores DOM nodes and prunes anything
that looks like form/sidebar/related-content, which kills the structured
ingredient grids on JS-framework recipe sites (we lost a 19-ingredient
recipe to a 1-ingredient skeleton on streetkitchen.hu before the switch).

### Hero image extraction

Inside the same fetched HTML the function looks for, in order:

1. `<meta property="og:image">`
2. `<meta name="twitter:image">`
3. The first `<img>` inside the article body whose `naturalWidth` (declared in
   `width=` attribute) is ≥ 600.

If found, the function downloads the image (≤ 5 MB, ≤ 8 s), uploads to
`imports/<uid>/<job_id>-hero.<ext>`, and returns its path in the draft. The
SPA on Save copies it to `recipe-images/<uid>/<recipe_id>.<ext>` (separate
RPC `app.promote_hero_image`).

### URL flow sequence (ASCII)

```
Browser                   Edge:import-url             Anthropic
   │  POST /import-url           │                      │
   │ ─────────────────────────►  │                      │
   │                             │ insert job(running)  │
   │                             │ fetch URL ──HTML──►  │
   │                             │ JSON-LD + strip      │
   │                             │ reserve budget       │
   │                             │ POST /chat ────────► │
   │                             │ ◄─── JSON ────────── │
   │                             │ Recipe.safeParse     │
   │                             │ update job(done)     │
   │  ◄────────── 200 + draft ── │                      │
   │ Edit Draft modal            │                      │
   │ Save → INSERT recipes...    │                      │
```

## Flow 2 — Instagram import

The caption comes from the post's public **`/embed/captioned/` page**
([`fallback.ts`](../supabase/functions/import-instagram/fallback.ts)). The
function extracts the shortcode from the post / reel / tv URL, normalises to
`https://www.instagram.com/p/<shortcode>/embed/captioned/`, and fetches it with
a realistic browser UA + `Accept-Language` and an 8s timeout. It then reads the
caption out of the rendered `<div class="Caption">` block (dropping the leading
`CaptionUsername` anchor, which it keeps as the author, and converting `<br>` to
newlines) and the cover image out of `<img class="EmbeddedMediaImage">`. HTML
entities (`&amp;`, `&quot;`, `&#x1f34b;`) are decoded so the model gets clean
text and the thumbnail URL resolves.

No API keys are used. Historically this was a multi-tier chain — Instagram oEmbed
via `IG_OEMBED_TOKEN` (Facebook Graph), the `/embed/captioned/` page, a direct
og-tag fetch of the post URL, a `ddinstagram.com` mirror, and ScraperAPI. #143
reduced it to the direct og-tag fetch, but as of 2026-06 Instagram serves a
logged-out wall (no `og:*` tags) to fetches of the **post page** from datacenter
IPs — the Edge Function's egress — so that path fails with `instagram_unavailable`
for every post (confirmed in prod `import_jobs` from ~2026-06-16). The
`/embed/captioned/` surface is built for third-party server-side rendering and
still returns the caption to datacenter IPs, so the pipeline fetches that instead.
It does not emit `og:*` tags (which is why #143 dropped it), but the caption is
rendered in the `Caption` div.

```
[Browser] POST /functions/v1/import-instagram { url, household_id }
[Edge]    auth + member check + import_jobs(running, kind=instagram)
[Edge]    extract shortcode → GET /p/<shortcode>/embed/captioned/
            (browser UA + Accept-Language, redirect: follow, 8s)
            on no shortcode / non-2xx / network error / no Caption block (login
              wall) → instagram_unavailable
            on 200 with a Caption block → parse <div class="Caption"> (author +
              text) and <img class="EmbeddedMediaImage"> (thumbnail), decode
              HTML entities
            caption = "@author" + "\n\n" + caption text; thumbnail = cover image
[Edge]    estimatedTokens = 1200
          callAndValidate(structuringFromCaption({ caption, sourceUrl: url }))
[Edge]    download thumbnail to imports/<uid>/<job_id>-hero.jpg if present
[Edge]    return { job_id, draft, hero_image_url? }
[Browser] Edit Draft → Save
```

> **Datacenter-IP risk.** The embed surface is currently the most reliable
> keyless path from a datacenter IP — but it is still Instagram, and they could
> wall embeds too. When a fetch yields no `Caption` block the job fails with
> `instagram_unavailable`. The only durable hedge is a residential-IP path (the
> removed ScraperAPI tier), which needs a paid key we don't have, so some posts
> may still fail depending on how Instagram treats the function's egress IP.

Caveats documented in user-facing copy:

- Private posts / login walls yield no `Caption` block → `instagram_unavailable`;
  the user sees a "couldn't reach this Instagram post" message and can try the photo tab.
- Reels and carousels: the caption is the cover + text only; the function asks the
  user to confirm which slide via a follow-up prompt only if the caption
  contains `#step` markers and the parser detects mismatched ingredients.
  v1 keeps this simple: caption-only, ignore carousel mechanics.

## Flow 3 — Photo import

```
[Browser] user picks image (≤ 10 MB after client-side downscale to 2000px)
[Browser] supabase.storage.from('imports').upload(`${uid}/${jobId}.jpg`, file)
[Browser] POST /functions/v1/import-photo
          { job_id, household_id, path: 'uid/jobId.jpg' }
[Edge]    create signed read URL for the object (TTL 5 min)
[Edge]    estimatedTokens = 3500
          callAndValidate(structuringFromImage({ imageUrl: signed }))
[Edge]    if validate.ok=false (low confidence):
            import_jobs.status='needs_review', return partial draft
[Edge]    on ok: status='done', return draft
[Browser] Edit Draft → Save
```

The signed URL must be in the `imports` bucket (private). Vision models
require a publicly fetchable URL; signed URLs satisfy that requirement
without exposing the object permanently.

Client-side downscale (Canvas API):

- Read `File`, draw to a 2000-px-longest-edge `OffscreenCanvas`,
  `toBlob({ type: 'image/jpeg', quality: 0.85 })`. Anything larger is rejected
  with "Image too large; please reduce or photograph at lower resolution."
- HEIC files: convert via `heic2any` only if the user opts in (size cost on
  the bundle); otherwise we surface "HEIC unsupported on this browser; please
  export as JPEG."

## Flow 4 — Manual entry

No Edge Function. The Add Recipe form (under
`/h/:householdId/import?tab=manual`) constructs a `Recipe` object client-side,
runs `Recipe.parse`, and calls `app.save_recipe(json)` directly. An empty
`import_jobs` row is *not* created — manual imports do not consume AI budget
and are not tracked.

## `app.save_recipe(json jsonb)` RPC

A single SECURITY DEFINER function turns a draft into rows. Defined in a
follow-up migration:

```sql
create or replace function app.save_recipe(p_household uuid, p_draft jsonb)
returns uuid language plpgsql security definer set search_path = app, public as $$
declare new_id uuid;
begin
  if not app.is_household_member(p_household) then
    raise exception 'not_household_member';
  end if;
  insert into app.recipes (
    household_id, created_by, title, description, source_type, source_url,
    source_language, canonical_unit_system, servings, total_time_min,
    hero_image_path
  ) values (
    p_household, auth.uid(),
    p_draft->>'title', p_draft->>'description',
    p_draft->>'source_type', p_draft->>'source_url',
    coalesce(p_draft->>'source_language', 'en'),
    p_draft->>'canonical_unit_system',
    (p_draft->>'servings')::int,
    nullif(p_draft->>'total_time_min','')::int,
    p_draft->>'hero_image_path'
  ) returning id into new_id;

  insert into app.recipe_ingredients
    (recipe_id, position, raw_text, quantity, unit, ingredient_name, notes)
  select new_id, (i.value->>'position')::int, i.value->>'raw_text',
         nullif(i.value->>'quantity','')::numeric,
         i.value->>'unit', i.value->>'ingredient_name', i.value->>'notes'
  from jsonb_array_elements(p_draft->'ingredients') as i;

  insert into app.recipe_steps (recipe_id, position, body, duration_min)
  select new_id, (s.value->>'position')::int, s.value->>'body',
         nullif(s.value->>'duration_min','')::int
  from jsonb_array_elements(p_draft->'steps') as s;

  insert into app.recipe_tags (recipe_id, tag)
  select new_id, t::text
  from jsonb_array_elements_text(coalesce(p_draft->'tags','[]'::jsonb)) as t
  on conflict do nothing;

  return new_id;
end;
$$;
```

The SPA always calls this RPC for both AI-derived and manual saves.

## Concurrency

A user may have at most **5** in-flight imports at once. "In-flight" counts
rows in `queued`, `running`, or `awaiting_save` (an `awaiting_save` row is a
completed-but-unsaved background draft and still occupies a slot until the SPA
saves it or the reaper expires it). Enforcement:

- Client guard: the active-imports provider tracks live rows; the import UI
  reflects them via the shell pill.
- Server check at the start of every Edge Function (after calling the reaper):

```sql
select count(*) from app.import_jobs
where profile_id = auth.uid()
  and status in ('queued', 'running', 'awaiting_save');
```

If `>= 5`, return 409 with body `{ error: 'too_many_imports' }`.

### Reaper

`app.reap_stuck_imports()` (called at the start of every import function) frees
slots that would otherwise wedge the cap:

- `running` rows older than **10 minutes** → `failed` / `error='timeout'`. The
  threshold comfortably exceeds the worst-case worker wall clock (AI client:
  3 attempts x 90 s + 1+2+4 s backoff ~= 4.6 min, plus scrape/save overhead).
- `awaiting_save` rows older than **30 minutes** → `failed` /
  `error='abandoned'`. A live tab re-drives `awaiting_save` rows within seconds
  (Realtime event or the on-mount backfill in `ActiveImportsProvider`), so only
  genuinely orphaned drafts are reaped. The draft survives in `payload.draft`,
  so nothing is lost server-side.

### SSRF guard (URL import)

`import-url` fetches a user-supplied URL via `_shared/scrape/ssrf-guard.ts`,
which rejects non-http(s) schemes and any hostname that resolves to a private /
loopback / link-local / reserved range (re-validated on every redirect hop). A
blocked target returns `400 { error: 'invalid_url' }`.

### AI budget

Token reservation enforces two windows (see [07-ai-integration.md](./07-ai-integration.md)):
a per-profile budget (`public.app_reserve_profile_ai_budget`) checked first, then
the global bucket (`public.app_reserve_ai_budget`). Either denial → `429`.

## Error matrix

| Failure | HTTP | UI copy |
|---|---|---|
| Network: source URL unreachable | 502 | "We couldn't reach that URL. Check the link or try again." |
| URL blocked by SSRF guard (private host / bad scheme) | 400 | "That link can't be imported. Use a public recipe URL." |
| AI/upstream failure (API error, connection, timeout) | 503 | "The importer is busy right now. Try again in a minute." |
| Photo path not owned by caller | 403 | "That photo doesn't belong to your account." |
| Uploaded object not an image (server-side check) | 415 | "That file is not a supported image. Use a JPEG or PNG." |
| Source ≥ 5 MB | 413 | "That source is too large. Use a shorter article." |
| AI parse failure (twice) | 200 + `needs_review` | "We couldn't parse this automatically. Edit the draft below." |
| AI schema failure | 200 + `needs_review` | same as above |
| Rate limit (Anthropic or own bucket) | 429 | "Importer is busy. Try again in a minute." |
| Instagram private post | 422 | "This post is private. Use a public post or the photo tab." |
| Photo too large | 413 | "Image is over 10 MB. Reduce size and try again." |
| Auth missing/expired | 401 | global session-expired toast |
| Not a household member | 403 | "You don't have permission to add to this household." |
| Five imports already in flight | 409 | "You already have five imports running. Wait for one to finish." |

All errors include `request_id` so users can quote it when filing a bug.

## Files this doc governs

- `/home/user/dishton/supabase/functions/import-url/index.ts`
- `/home/user/dishton/supabase/functions/import-url/_test.ts`
- `/home/user/dishton/supabase/functions/import-instagram/index.ts`
- `/home/user/dishton/supabase/functions/import-instagram/_test.ts`
- `/home/user/dishton/supabase/functions/import-photo/index.ts`
- `/home/user/dishton/supabase/functions/import-photo/_test.ts`
- `/home/user/dishton/supabase/functions/translate-recipe/index.ts` (called
  from view-time, see [09-recipe-views.md](./09-recipe-views.md))
- `/home/user/dishton/src/routes/(app)/h/$householdId/import/index.tsx`
- `/home/user/dishton/src/ui/recipe/RecipeImportPanel.tsx`
- `/home/user/dishton/src/ui/recipe/RecipeDraftEditor.tsx`
- `/home/user/dishton/src/lib/forms/import.ts` (Zod input schemas)
- A migration adding `app.save_recipe(jsonb)` and the in-flight-job server check.

## Acceptance criteria

- [ ] All four flows produce a draft Recipe that round-trips through
      `Recipe.parse` without modification.
- [ ] `import-url` against the BBC Good Food fixture in `e2e/fixtures/`
      returns a draft with ≥ 3 ingredients and ≥ 3 steps in the smoke test.
- [ ] `import-instagram` against a canned og-tag HTML fixture returns a draft
      with the caption-derived ingredients.
- [ ] `import-photo` against the recipe-photo fixture returns either a draft
      or `needs_review`; never crashes.
- [ ] Manual entry never writes an `import_jobs` row.
- [ ] A user with two running jobs receives `409 too_many_imports` on a third.
- [ ] On rate-limit, the SPA shows a persistent "Importer is busy" toast that
      auto-dismisses after the `retry_after` window.
- [ ] `app.save_recipe` is the only writer of `app.recipes`.
- [ ] Hero image promotion (imports → recipe-images) only happens on Save.
- [ ] No emojis in this doc or any governed file.

## Verification

```bash
test -f docs/08-import-pipelines.md
grep -q "## Purpose"                docs/08-import-pipelines.md
grep -q "## Files this doc governs" docs/08-import-pipelines.md
grep -q "## Acceptance criteria"    docs/08-import-pipelines.md
grep -q "## Verification"           docs/08-import-pipelines.md
! grep -P '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]' docs/08-import-pipelines.md
for s in import-url import-instagram import-photo save_recipe \
         "structuringFromHtml" "structuringFromCaption" "structuringFromImage" \
         too_many_imports needs_review; do
  grep -q "$s" docs/08-import-pipelines.md || echo "missing: $s"
done
```

End-to-end:

```bash
pnpm test:edge
pnpm test:e2e --grep "URL import"
```
