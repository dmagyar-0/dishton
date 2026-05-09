# Eval Harness — Instagram Support — Design

**Date:** 2026-05-09
**Status:** Draft for review
**Owner:** David
**Scope:** Add `structuringFromCaption` (Instagram) path to the NIM eval
harness so Instagram reel/post URLs in `eval/nim/urls.txt` exercise the same
production code path as the `import-instagram` Edge Function.

## Purpose

Today the eval harness only mirrors the `import-url` Edge Function: it fetches
HTML, runs `lightStripHtml`, and prompts each candidate with
`structuringFromHtml`. Instagram URLs in `urls.txt` always fail — usually with
`fetch_failed` (Instagram blocks the bot UA) or, on the rare 200 OK,
`schema:title` (the stripped page has no recipe content).

In production, Instagram URLs follow a different path:
`detectImportSource` routes them to the `import-instagram` Edge Function,
which fetches the caption via Instagram's oEmbed endpoint (or the Open Graph
meta tags as fallback) and calls `structuringFromCaption`.

This change makes the eval harness mirror that production path so the user
can drop a mix of HTML recipe URLs and Instagram URLs into one `urls.txt`
file and get a fair, production-equivalent evaluation across every candidate
model.

## Non-goals

- Photo / `structuringFromImage` lane. Out of scope (separate spec).
- `translatePrompt`. Out of scope.
- Authenticated Instagram fetches (session cookies, login). Production does
  not authenticate either; we keep parity.
- A new column or section in the Markdown report. Instagram outcomes share
  the existing per-URL table.
- Per-source candidate filtering. The same `candidates` list runs against
  both URL and Instagram lines.

## Inputs (unchanged)

- `eval/nim/urls.txt` — now accepts Instagram URLs (`instagram.com` or any
  subdomain) interleaved with HTML recipe URLs.
- `IG_OEMBED_TOKEN` — optional. If set, the harness uses Instagram oEmbed
  for richer captions; otherwise it falls back to OG meta scraping. This is
  the same env var production reads (`supabase/functions/_shared/env.ts`).

## Architecture

### Source-of-truth: shared caption fetcher

Production's `fetchOEmbed` and `fetchOgFallback` (currently inlined in
`supabase/functions/import-instagram/index.ts`) move to a new shared module:

```
supabase/functions/_shared/scrape/instagram-caption.ts
```

Public surface:

```ts
export type InstagramCaption = {
  caption: string;          // production's "${title}\n\n${stripped(description)}"
  thumbnailUrl: string | null;
  source: 'oembed' | 'og';
};

export async function fetchInstagramCaption(
  url: string,
  opts: { token?: string; signal?: AbortSignal },
): Promise<InstagramCaption | null>;
```

Internals:

- `fetchOEmbed(url, token, signal)` — calls
  `https://graph.facebook.com/v18.0/instagram_oembed?url=…&access_token=…`,
  returns `OEmbed | null` (null on non-2xx).
- `fetchOgFallback(url, signal)` — `GET url` with UA
  `DishtonBot/0.1 (+https://dishton.app)`, regex-extracts
  `og:title` / `og:description` / `og:image`, returns `OEmbed | null`.
- `fetchInstagramCaption` chains them: oEmbed first if `opts.token` is set,
  fallback to OG. Assembles caption identically to production:
  `${title}\n\n${(html ?? '').replace(/<[^>]+>/g, '')}`.
- 10-second per-fetch timeout via `AbortSignal.any`/`AbortSignal.timeout`,
  matching production's `mergeSignal` helper.

`supabase/functions/import-instagram/index.ts` is rewritten to delegate
to this helper. Behavior is byte-identical to today (verified by leaving the
existing `_test.ts` untouched).

### Eval harness branch

`eval/nim/fetch.ts` gains a sibling helper:

```ts
export async function fetchInstagramForEval(
  url: string,
  signal?: AbortSignal,
): Promise<{ caption: string; thumbnailUrl: string | null }>;
```

Throws a `FetchError('instagram_unavailable')` (new reason variant) if the
caption fetch returns null. Otherwise returns the caption + thumbnail. The
helper reads `IG_OEMBED_TOKEN` from `Deno.env` internally.

`eval/nim/run.ts` changes:

1. Per-line host detection in the existing fetch loop:
   ```ts
   const isInstagram = isInstagramUrl(url);  // host === 'instagram.com' || endsWith('.instagram.com')
   ```
   The detection helper is duplicated as a 3-line inline check, not imported
   from `src/lib/forms/import.ts` (the `src/` tree is browser-bundled and
   we don't want eval to drag it in).

2. For Instagram lines:
   - Call `fetchInstagramForEval(url)`.
   - Build a bundle with `{ url, text: caption, scraped: null }` so the
     existing `bundles[]` shape is reused.
   - In the per-model fan-out, dispatch to a new `callOnceCaption` that
     uses `structuringFromCaption({ caption, sourceUrl })` instead of
     `structuringFromHtml`.

3. For non-Instagram lines: unchanged.

The report renderer (`eval/nim/report.ts`) needs no changes — the existing
`UrlBundle` and `ModelOutcome` shapes accept either source. The
`sourceExcerpt` column shows the caption verbatim for Instagram, and the
`jsonldFound` column is always `false` for Instagram.

### Data flow (Instagram line)

```
urls.txt → run.ts.main loop → isInstagramUrl(url) === true
        → fetchInstagramForEval(url)
        →   _shared/scrape/instagram-caption.ts.fetchInstagramCaption(...)
        →     oEmbed (if IG_OEMBED_TOKEN) → OG fallback → null?
        → bundle { url, text: caption, scraped: null, jsonldFound: false }
        → for each candidate:
            structuringFromCaption({ caption, sourceUrl: url })
            → callNim / callAnthropic
            → Recipe.safeParse(raw) → schemaOk
        → report row appended
```

## Error handling

| Condition | Behavior |
|-----------|----------|
| Instagram caption fetch returns null (oEmbed and OG both failed/empty) | URL goes to `skippedUrls` with reason `instagram_unavailable` (mirrors production's HTTP 422 reason). |
| Instagram fetch times out (10 s per fetch) | `skippedUrls` with reason `timeout`. |
| Instagram fetch network error | `skippedUrls` with reason `network`. |
| Caption fetched but model call fails (HTTP, schema) | Existing per-model error handling — no change. |

The `FetchError.reason` union gains `'instagram_unavailable'`. All other
existing reasons are unchanged.

## Testing

### Unit: `_shared/scrape/instagram-caption_test.ts`

Mocks `globalThis.fetch`. Cases:

1. oEmbed token set + oEmbed returns 200 with `{ title, html, thumbnail_url }`
   → returns `{ caption: 'title\n\nstripped', source: 'oembed' }`.
2. oEmbed token set + oEmbed returns 401 → falls back to OG.
3. oEmbed token unset → goes straight to OG.
4. OG returns 200 with `og:title`/`og:description`/`og:image` meta → returns
   `{ caption, source: 'og' }`.
5. OG returns 200 but missing both `og:title` and `og:description` → returns
   `null`.
6. OG returns 4xx → returns `null`.
7. Caller signal aborts mid-fetch → propagates abort.

### Integration: `eval/nim/instagram_test.ts`

- `fetchInstagramForEval` happy path (mocked underlying `fetch`).
- `fetchInstagramForEval` null result → throws `FetchError('instagram_unavailable')`.
- A `run.ts` smoke test (or table-style assertion in
  `_test.ts`) that the prompt builder for an Instagram bundle is
  `structuringFromCaption`, not `structuringFromHtml`. Cleanest assertion:
  pass a fake `callNim` and check the `messages[0].content` matches the
  caption-prompt system message.

### Existing tests stay green

`supabase/functions/import-instagram/_test.ts` is untouched and must still
pass after the helper extraction.

## Documentation

`eval/nim/README.md` gets a paragraph:

> Instagram URLs (`instagram.com/...`) are auto-detected and routed through
> the same caption-fetch path as the production `import-instagram` function.
> Set `IG_OEMBED_TOKEN` in `.env` for richer oEmbed captions; without it, the
> harness falls back to scraping `og:title` / `og:description` from the page.
> The harness then prompts each candidate with `structuringFromCaption`
> (not `structuringFromHtml`).

`docs/00-overview.md` doc map entry only mentioned if the existing eval entry
needs updating — checked separately during implementation.

## Files touched

| Path | Change |
|------|--------|
| `supabase/functions/_shared/scrape/instagram-caption.ts` | new — extracted helper |
| `supabase/functions/_shared/scrape/instagram-caption_test.ts` | new — unit tests |
| `supabase/functions/import-instagram/index.ts` | rewrite to delegate to helper |
| `eval/nim/fetch.ts` | add `fetchInstagramForEval`; new FetchError reason variant |
| `eval/nim/run.ts` | per-line Instagram detection; caption branch in fetch + call |
| `eval/nim/instagram_test.ts` | new — integration test |
| `eval/nim/README.md` | document Instagram support + optional token |

## Rollout

This is a developer-tool change with no production-runtime behavioral change
(the helper extraction is a pure refactor of `import-instagram`). Merge
behind a single PR; no migration, no flag.
