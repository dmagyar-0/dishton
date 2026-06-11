# Agent-readable public recipe pages — design

Date: 2026-06-11
Status: approved for implementation (task-directed)

Amends `2026-06-11-public-recipe-share-design.md` (the "share spec"). That
spec deliberately served crawlers only an Open Graph *card* (title + a
one-line summary + image) and set `noindex`, so the actual recipe was
readable only by a JavaScript-capable browser running the SPA. This change
makes the public page natively readable — and now indexable — by agents
that do **not** run JavaScript (AI assistants, LLM browse tools, search
crawlers, plain HTTP clients).

## 1. What we're building

Two coordinated changes to the existing `/r/<token>` share surface:

1. **Broaden the bot rewrite** so non-browser / unknown User-Agents (not
   just the handful of unfurlers) are routed to the `public-recipe` Edge
   Function instead of the SPA shell.
2. **Turn the Edge Function's meta document into a full, self-contained
   recipe page**: the existing OG/Twitter tags **plus** Schema.org `Recipe`
   JSON-LD **plus** visible semantic HTML (ingredients, steps, attribution).
   Drop `noindex` and the meta-refresh.

No new secrets, DB schema, RLS policy, or RPC. The recipe data is already
public-by-token via `app.get_public_recipe`; we only change *how the
existing payload is rendered* and *which clients are routed to it*.

## 2. Goals & non-goals

**Goals**
- An agent that fetches `https://<app>/r/<token>` with a non-browser UA
  receives the full recipe (ingredients + steps) in the HTML response,
  both as machine-readable JSON-LD and as human-readable markup.
- Real browsers are unaffected: they still get the interactive SPA.
- Shared recipes become eligible for search indexing (user-directed
  reversal of the share spec's `noindex` decision — see §7).
- Zero new data exposure: the whitelisted projection is unchanged.

**Non-goals (YAGNI)**
- No SSR/prerender of the SPA route. The Edge Function remains the
  no-JavaScript representation; the SPA remains the interactive one.
- No reverse-DNS / cryptographic bot verification (Approach C, rejected).
- No new recipe fields in the public payload (no timestamps, no author
  identity beyond the existing household name).
- No translation/units toggle in the static page (source language + canonical
  units only, as in the share spec).

## 3. Architecture

```
                      ┌─ UA ∈ agent allowlist ──────────┐
/r/<token> ─► Vercel ─┤                                  ├─► public-recipe Edge Fn
                      └─ UA missing "mozilla" ───────────┘   (full recipe HTML)
                      └─ otherwise (real browsers) ─────────► SPA (index.html)
```

Rewrite rules are first-match-wins, ordered before the SPA catch-all. The
classification is intentionally leaky (UA strings are spoofable); the
allowlist covers today's major AI agents, the `missing mozilla` rule covers
blank/unknown/CLI clients, and a brand-new crawler that both spoofs
`Mozilla` *and* isn't on the allowlist degrades to the SPA — a tolerable
miss, fixed by adding its token.

## 4. Routing — `vercel.json`

Replace the single bot rewrite with two rules (both → the same Supabase
function destination already used today), kept **above** the SPA catch-all:

```jsonc
// Rule 1 — known agents: generic crawlers (bot/crawler/spider — already
// covers Googlebot, bingbot, Slackbot, Discordbot, TelegramBot, Twitterbot,
// LinkedInBot, GPTBot, ClaudeBot, PerplexityBot, Amazonbot, Applebot, CCBot,
// …) plus the AI agents whose UA does NOT contain "bot" (ChatGPT-User,
// Claude-Web, Perplexity-User, Google-Extended, Bytespider, anthropic-ai,
// cohere-ai, Gemini, Bard) and the non-"bot" unfurlers.
{
  "source": "/r/:token",
  "has": [{ "type": "header", "key": "user-agent",
    "value": "(?i).*(bot|crawler|spider|facebookexternalhit|embedly|quora|vkshare|chatgpt|oai-searchbot|anthropic|claude|perplexity|google-extended|bytespider|cohere|gemini|bard).*" }],
  "destination": "https://hdfpnxjxrcupuxrgrnpf.supabase.co/functions/v1/public-recipe/:token"
},
// Rule 2 — anything whose UA lacks "mozilla" (curl, wget, python-requests,
// go-http-client, okhttp, blank UA, plus unfurlers like WhatsApp/2.x and
// facebookexternalhit). Real browsers — and JS-capable in-app webviews —
// always send "Mozilla/5.0 …", so they never match and fall through to the SPA.
{
  "source": "/r/:token",
  "missing": [{ "type": "header", "key": "user-agent", "value": "(?i).*mozilla.*" }],
  "destination": "https://hdfpnxjxrcupuxrgrnpf.supabase.co/functions/v1/public-recipe/:token"
}
```

`missing` is satisfied when no `user-agent` header matches the value (header
absent **or** value lacks `mozilla`) — confirmed against Vercel's route
schema. Destination domain stays hardcoded to the Supabase project, matching
the existing rule and the CSP in the same file.

**Why no bare social-app tokens.** The original rule carried bare `slack`,
`telegram`, `discord`, `twitter`, `linkedin`, `skype`, `whatsapp`, `preview`.
Those also match JS-capable **in-app browsers** (a LinkedIn/Facebook webview
UA contains the app name *and* `Mozilla/5.0 …`). The old design tolerated
that because the meta-refresh bounced such humans to the SPA; since we drop
the refresh (§5/§7), we must not strand them. We therefore route only on
`bot`-class tokens, explicit AI agents, and the `missing mozilla` rule — the
social *fetchers* (Slackbot, TelegramBot, Twitterbot, facebookexternalhit,
WhatsApp/2.x) still reach the function via `bot` or the missing-mozilla rule,
while real in-app browsers (carrying `Mozilla`) correctly get the SPA.

**Edge cases.** Invalid tokens still 404 at the function (its
`^[0-9a-f]{16,64}$` check). The `/r/:token` source matches a single segment
only, so junk paths can't fan out. Broader traffic to the function is cheap:
unknown tokens 404 fast; valid ones are cached (`s-maxage=3600`).

## 5. Edge HTML — `public-recipe/meta.ts` + `index.ts`

Rename `buildMetaHtml` → **`buildRecipePage`**, taking the richer input and
emitting a complete page. Sections, in `<head>` then `<body>`:

- **Head:** `<title>{title} — Dishton</title>`, `meta description`,
  `robots index,follow` (was `noindex`), `<link rel="canonical">`, the
  existing `og:*` / `twitter:*` tags + `og:image` (the og.png), and a
  `<script type="application/ld+json">` block (see §6). **No** meta-refresh.
- **Body (visible, semantic):** `<h1>{title}</h1>`; "From {household}'s
  pantry"; description paragraph (when present); `<h2>Ingredients</h2>` +
  `<ul>` of ingredient lines; `<h2>Steps</h2>` + `<ol>` of step bodies; a
  tag list; the source link (when present); and an **"Open in Dishton →"**
  anchor to the canonical SPA URL (replaces the dropped meta-refresh for the
  rare misrouted human, who now gets a fully readable — if unstyled — page).
  Minimal inline styles for legibility only.

`index.ts` changes:
- Extend `PublicRecipePayload` to carry the fields the RPC already returns:
  `steps`, `tags`, `source_url`, `source_language` (alongside the current
  `title`, `description`, `servings`, `total_time_min`, `hero_image_path`,
  `ingredients`, and top-level `household_name`).
- `handleMeta` maps the payload into `buildRecipePage` inputs and calls
  `recipeJsonLd` (§6). Drop the `x-robots-tag: noindex` response header.
- `handleOgImage` and the og.png path are unchanged.

**Escaping (top risk — all values are user-controlled).**
- Visible HTML: every interpolated value goes through the existing
  `escapeHtml` (title, description, household, each ingredient line, each
  step body, each tag, source URL + its visible text).
- JSON-LD: `JSON.stringify` the object (which already escapes quotes and
  backslashes), then neutralise the three characters that could terminate or
  reopen the script element:

  ```
  json.replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026')
  ```

  so a literal `</script>` inside any string can't break out. Tested with a
  `<script>`-laden title.

## 6. Domain helper — `src/domain/share.ts`

Pure, I/O-free, shared with the Edge Function via the `_shared/domain`
symlink; unit-tested to the domain 90% threshold.

- **`ingredientLine(ing)`** → display string: `ing.raw_text` when present
  (trimmed), else `[quantity, unit, ingredient_name].filter(Boolean).join(' ')`
  with `notes` appended in parens. Used by **both** the JSON-LD
  `recipeIngredient` and the visible `<ul>` so they never diverge.
- **`isoDuration(min)`** → `PT{min}M` (or `null` for null/≤0).
- **`recipeJsonLd(recipe, opts)`** → a plain JS object:

  | JSON-LD field           | Source                                            |
  |-------------------------|---------------------------------------------------|
  | `@context` / `@type`    | `"https://schema.org"` / `"Recipe"`               |
  | `name`                  | `recipe.title`                                    |
  | `description`           | `recipe.description` (when present)               |
  | `image`                 | `[opts.imageUrl]` (the og.png)                    |
  | `author`                | `{ "@type": "Organization", name: householdName }`|
  | `url` / `mainEntityOfPage` | `opts.url` (canonical)                         |
  | `recipeYield`           | `String(recipe.servings)`                         |
  | `totalTime`             | `isoDuration(recipe.total_time_min)` (omit if null)|
  | `recipeIngredient`      | `recipe.ingredients.map(ingredientLine)`          |
  | `recipeInstructions`    | `steps.map(s => ({ "@type":"HowToStep", text:s.body }))` |
  | `keywords`              | `recipe.tags.join(', ')` (omit when empty)        |
  | `inLanguage`            | `recipe.source_language`                          |

  Empty/null optional fields are omitted, not emitted as `null`.

Input type is a minimal `PublicRecipe` projection declared in `share.ts`
(not the full domain `Recipe`), matching the RPC whitelist.

## 7. Security & edge cases

- **Indexing reversal (deliberate, user-directed).** Dropping `noindex`
  means a shared recipe can appear in search results once a crawler sees its
  link — reversing share-spec §8's "unlisted" stance. The token still gates
  *which* recipes have a public page; nothing un-shared is exposed. Revoke =
  delete the share row (unchanged); a revoked page 404s and drops out of the
  index on recrawl.
- **No new data exposure.** Same whitelisted projection; no ids, timestamps,
  profiles, or household id. `source_url` was already public content.
- **XSS** is the primary risk and is handled per §5 (HTML-escape everywhere;
  JSON-LD `<`/`>`/`&`-escaped inside the script tag).
- **UA leakiness** is accepted and documented (§3). Worst case is a generic
  unfurl/SPA fallback, never a broken page.
- **Redirect loops** are eliminated: removing the meta-refresh means a
  misrouted client is never bounced anywhere.
- **CSP / secrets:** unchanged.

## 8. Doc updates (ship with the feature)

- `docs/00-overview.md`, `docs/04-data-model.md`, `docs/15-roadmap-and-flags.md`:
  amend any "noindex / not indexed" wording for share pages to reflect that
  public recipe pages are now agent-readable and indexable.
- `2026-06-11-public-recipe-share-design.md`: add a one-line header note that
  §2/§5/§8 (noindex, crawler = card only, meta-refresh) are amended by this
  spec.

## 9. Testing

- **Domain** (`src/domain/share.test.ts`, `pnpm test:unit`): `recipeJsonLd`
  field mapping; `recipeIngredient` from `raw_text` vs. composed fallback;
  `recipeInstructions` as `HowToStep`; `totalTime` present/omitted;
  `keywords` present/omitted; `ingredientLine` permutations; `isoDuration`.
- **Edge** (`supabase/functions/public-recipe/meta_test.ts`, `pnpm test:edge`):
  `buildRecipePage` contains the `<h1>` title, every ingredient line, every
  step body, a JSON-LD `Recipe` script; `robots` is `index,follow` (not
  `noindex`); **no** `http-equiv="refresh"`; the "Open in Dishton" link;
  and a `<script>`-laden title is neutralised in **both** the visible markup
  and the JSON-LD (no raw `</script>`; `<` present). Update the two
  existing assertions that check for `noindex` and the refresh.
- **Routing** (vitest, e.g. `src/lib/public-share-routing.test.ts`): read
  `vercel.json`, extract the two `/r/:token` UA regexes (translate the
  leading `(?i)` to the `i` flag), and assert classification — Chrome,
  Safari, Firefox, iOS Safari, Android Chrome, **and JS-capable in-app
  webviews (LinkedInApp, Facebook FBAN/FBAV, Instagram)** → SPA (no allowlist
  match; UA contains `mozilla`); Googlebot, GPTBot, ChatGPT-User, ClaudeBot,
  PerplexityBot, Bytespider, facebookexternalhit, `WhatsApp/2.x`, `curl/8.6`,
  `python-requests/2.32`, and empty UA → routed to the Edge Function. The
  in-app-webview cases lock in the §4 decision to drop bare social tokens and
  guard against ever routing a real browser to the bare page.
- **Visual validation** (`validating-features-visually`): the SPA path at
  `/r/<seeded-token>` still renders (desktop + mobile) for a browser; the
  Edge HTML path is validated by rendering `buildRecipePage` to a static
  `.html` file and screenshotting it (the local stack can't run Edge
  Functions per CLAUDE.md), confirming ingredients/steps/JSON-LD are present
  and the human fallback is legible.
- **CI:** no migration (no schema change); typecheck + Biome + the suites
  above must pass.
