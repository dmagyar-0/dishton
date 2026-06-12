# Agent-readable public recipe pages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let non-browser clients (AI agents, crawlers, CLI fetchers) read a shared recipe at `/r/<token>` without JavaScript, by routing them to the `public-recipe` Edge Function and rendering the full recipe there as Schema.org `Recipe` JSON-LD + visible HTML; make the page indexable.

**Architecture:** Two coordinated changes. (1) `vercel.json` gets two ordered `/r/:token` rewrites — an agent allowlist plus a "UA missing `mozilla`" catch-all — so everything that isn't a real browser hits the Edge Function. (2) The Edge Function's meta document (`meta.ts`) becomes a full recipe page (JSON-LD + semantic HTML, `index,follow`, no meta-refresh), fed by a pure `recipeJsonLd()` domain helper. No DB/RPC/secret changes — the data is already public-by-token.

**Tech Stack:** TypeScript, Deno (Edge Functions), Vitest (domain + routing tests), `@std/assert` (Deno tests), Vercel rewrites, Schema.org Recipe JSON-LD.

**Spec:** `docs/superpowers/specs/2026-06-11-agent-readable-public-recipe-design.md`

---

## File structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/domain/share.ts` | Pure share helpers (shared with Edge Fn via `_shared/domain` symlink) | Add `ShareRecipe`/`ShareIngredient`/`ShareStep` types, `ingredientLine`, `isoDuration`, `recipeJsonLd` |
| `src/domain/share.test.ts` | Domain unit tests | Add tests for the three new helpers |
| `supabase/functions/public-recipe/meta.ts` | Server-rendered recipe page builder | Rename `buildMetaHtml` → `buildRecipePage`; render JSON-LD + visible HTML; `index,follow`; drop meta-refresh |
| `supabase/functions/public-recipe/meta_test.ts` | Edge builder tests | Replace `buildMetaHtml` tests with `buildRecipePage` tests |
| `supabase/functions/public-recipe/index.ts` | Routing + handlers | Extend payload type, call `buildRecipePage`, drop `x-robots-tag: noindex` |
| `vercel.json` | Edge routing | Replace the single bot rewrite with two (allowlist + missing-mozilla) |
| `src/lib/public-share-routing.test.ts` | Routing classification test | New: assert browsers→SPA, agents→Edge |
| `docs/00-overview.md`, `docs/04-data-model.md`, `docs/15-roadmap-and-flags.md`, `docs/superpowers/specs/2026-06-11-public-recipe-share-design.md` | Docs | Amend noindex/crawler wording |

---

## Task 1: Domain helpers — `ingredientLine`, `isoDuration`, `recipeJsonLd`

**Files:**
- Modify: `src/domain/share.ts`
- Test: `src/domain/share.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/domain/share.test.ts`, change the import on line 2 from:

```ts
import { sharePath, shareSummary } from './share.ts';
```

to:

```ts
import {
  ingredientLine,
  isoDuration,
  recipeJsonLd,
  type ShareIngredient,
  type ShareRecipe,
  sharePath,
  shareSummary,
} from './share.ts';
```

Then append to the end of the file:

```ts
const potatoes: ShareIngredient = {
  raw_text: '800g waxy potatoes',
  ingredient_name: 'waxy potatoes',
  quantity: 800,
  unit: 'g',
  notes: null,
};
const eggs: ShareIngredient = {
  raw_text: null,
  ingredient_name: 'eggs',
  quantity: 6,
  unit: null,
  notes: 'hard-boiled',
};
const sampleRecipe: ShareRecipe = {
  title: 'Rakott Krumpli',
  description: 'Hungarian layered potato casserole.',
  servings: 4,
  total_time_min: 80,
  source_url: 'https://example.com/rakott',
  source_language: 'en',
  tags: ['hungarian', 'comfort'],
  ingredients: [potatoes, eggs],
  steps: [
    { body: 'Boil the potatoes.', position: 0 },
    { body: 'Layer and bake.', position: 1 },
  ],
};

describe('ingredientLine', () => {
  it('prefers the raw imported line', () => {
    expect(ingredientLine(potatoes)).toBe('800g waxy potatoes');
  });
  it('composes qty/unit/name with notes in parens when there is no raw_text', () => {
    expect(ingredientLine(eggs)).toBe('6 eggs (hard-boiled)');
  });
  it('drops a missing quantity and unit', () => {
    expect(
      ingredientLine({
        raw_text: null,
        ingredient_name: 'salt',
        quantity: null,
        unit: null,
        notes: null,
      }),
    ).toBe('salt');
  });
});

describe('isoDuration', () => {
  it('formats minutes as an ISO-8601 duration', () => {
    expect(isoDuration(80)).toBe('PT80M');
  });
  it('returns null for null or non-positive input', () => {
    expect(isoDuration(null)).toBeNull();
    expect(isoDuration(0)).toBeNull();
  });
});

describe('recipeJsonLd', () => {
  const opts = {
    url: 'https://app.example/r/tok123',
    imageUrl: 'https://fns.example/og.png',
    householdName: 'My Recipes',
  };
  it('maps the recipe into a Schema.org Recipe object', () => {
    const ld = recipeJsonLd(sampleRecipe, opts);
    expect(ld['@type']).toBe('Recipe');
    expect(ld.name).toBe('Rakott Krumpli');
    expect(ld.recipeYield).toBe('4');
    expect(ld.totalTime).toBe('PT80M');
    expect(ld.inLanguage).toBe('en');
    expect(ld.keywords).toBe('hungarian, comfort');
    expect(ld.recipeIngredient).toEqual(['800g waxy potatoes', '6 eggs (hard-boiled)']);
    expect(ld.recipeInstructions).toEqual([
      { '@type': 'HowToStep', text: 'Boil the potatoes.' },
      { '@type': 'HowToStep', text: 'Layer and bake.' },
    ]);
    expect(ld.author).toEqual({ '@type': 'Organization', name: 'My Recipes' });
  });
  it('omits totalTime, keywords, and description when absent', () => {
    const ld = recipeJsonLd(
      { ...sampleRecipe, description: null, total_time_min: null, tags: [] },
      opts,
    );
    expect(ld.totalTime).toBeUndefined();
    expect(ld.keywords).toBeUndefined();
    expect(ld.description).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run src/domain/share.test.ts`
Expected: FAIL — `ingredientLine`, `isoDuration`, `recipeJsonLd` (and the new types) are not exported from `./share.ts`.

- [ ] **Step 3: Implement the helpers**

Append to `src/domain/share.ts`:

```ts
export type ShareIngredient = {
  raw_text: string | null;
  ingredient_name: string;
  quantity: number | null;
  unit: string | null;
  notes: string | null;
};

export type ShareStep = {
  body: string;
  position: number;
};

export type ShareRecipe = {
  title: string;
  description: string | null;
  servings: number;
  total_time_min: number | null;
  source_url: string | null;
  source_language: string;
  tags: string[];
  ingredients: ShareIngredient[];
  steps: ShareStep[];
};

export type RecipeJsonLdOptions = {
  url: string;
  imageUrl: string;
  householdName: string;
};

// One display line per ingredient. Prefers the imported `raw_text`; otherwise
// composes "<qty> <unit> <name> (<notes>)" from the structured fields. Shared
// by the JSON-LD `recipeIngredient` list and the page's visible <ul> so the
// two never drift apart.
export function ingredientLine(ing: ShareIngredient): string {
  const raw = ing.raw_text?.trim();
  if (raw) return raw;
  const parts: string[] = [];
  if (ing.quantity != null) parts.push(String(ing.quantity));
  if (ing.unit) parts.push(ing.unit);
  parts.push(ing.ingredient_name);
  const head = parts.join(' ').trim();
  const notes = ing.notes?.trim();
  return notes ? `${head} (${notes})` : head;
}

// ISO-8601 duration for Schema.org `totalTime`. Null/non-positive -> null (omit).
export function isoDuration(min: number | null): string | null {
  return min != null && min > 0 ? `PT${min}M` : null;
}

// Schema.org Recipe projection for the public page's <script type="ld+json">.
// Pure: returns a plain object; the Edge Function serialises and HTML-escapes
// it. Optional fields are omitted (not emitted as null) when absent.
export function recipeJsonLd(
  recipe: ShareRecipe,
  opts: RecipeJsonLdOptions,
): Record<string, unknown> {
  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: recipe.title,
    url: opts.url,
    mainEntityOfPage: opts.url,
    image: [opts.imageUrl],
    author: { '@type': 'Organization', name: opts.householdName },
    recipeYield: String(recipe.servings),
    recipeIngredient: recipe.ingredients.map(ingredientLine),
    recipeInstructions: recipe.steps.map((s) => ({ '@type': 'HowToStep', text: s.body })),
    inLanguage: recipe.source_language,
  };
  const description = recipe.description?.trim();
  if (description) jsonLd.description = description;
  const totalTime = isoDuration(recipe.total_time_min);
  if (totalTime) jsonLd.totalTime = totalTime;
  if (recipe.tags.length > 0) jsonLd.keywords = recipe.tags.join(', ');
  return jsonLd;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/domain/share.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors. (If Biome reports formatting, run `pnpm format` and re-run `pnpm lint`.)

- [ ] **Step 6: Commit**

```bash
git add src/domain/share.ts src/domain/share.test.ts
git commit -m "feat(share): recipeJsonLd + ingredient/duration helpers for public page"
```

---

## Task 2: Edge page builder — `buildRecipePage`

**Files:**
- Modify: `supabase/functions/public-recipe/meta.ts` (full rewrite — rename `buildMetaHtml` → `buildRecipePage`)
- Test: `supabase/functions/public-recipe/meta_test.ts` (full rewrite)

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `supabase/functions/public-recipe/meta_test.ts` with:

```ts
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import type { ShareRecipe } from '../_shared/domain/share.ts';
import { buildRecipePage, escapeHtml } from './meta.ts';

const recipe: ShareRecipe = {
  title: 'Rakott Krumpli',
  description: 'Hungarian layered potato casserole.',
  servings: 4,
  total_time_min: 80,
  source_url: 'https://example.com/rakott',
  source_language: 'en',
  tags: ['hungarian', 'comfort'],
  ingredients: [
    {
      raw_text: '800g waxy potatoes',
      ingredient_name: 'waxy potatoes',
      quantity: 800,
      unit: 'g',
      notes: null,
    },
    { raw_text: null, ingredient_name: 'eggs', quantity: 6, unit: null, notes: 'hard-boiled' },
  ],
  steps: [
    { body: 'Boil the potatoes.', position: 0 },
    { body: 'Layer and bake.', position: 1 },
  ],
};

function page(overrides: Partial<ShareRecipe> = {}): string {
  return buildRecipePage({
    recipe: { ...recipe, ...overrides },
    householdName: 'My Recipes',
    description: '4 servings · 80 min · 2 ingredients',
    canonicalUrl: 'https://app.example/r/tok123',
    ogImageUrl: 'https://fns.example/public-recipe/tok123/og.png',
  });
}

Deno.test('escapeHtml neutralises markup-significant characters', () => {
  assertEquals(
    escapeHtml(`<script>alert("x&y'")</script>`),
    '&lt;script&gt;alert(&quot;x&amp;y&#39;&quot;)&lt;/script&gt;',
  );
});

Deno.test('buildRecipePage renders the full recipe as visible HTML', () => {
  const html = page();
  assertStringIncludes(html, '<h1>Rakott Krumpli</h1>');
  assertStringIncludes(html, "From My Recipes's pantry");
  assertStringIncludes(html, '<li>800g waxy potatoes</li>');
  assertStringIncludes(html, '<li>6 eggs (hard-boiled)</li>');
  assertStringIncludes(html, '<li>Boil the potatoes.</li>');
  assertStringIncludes(html, '<li>Layer and bake.</li>');
  assertStringIncludes(html, 'Open in Dishton');
  assertStringIncludes(html, 'Hungarian layered potato casserole.');
});

Deno.test('buildRecipePage embeds Schema.org Recipe JSON-LD', () => {
  const html = page();
  assertStringIncludes(html, '<script type="application/ld+json">');
  assertStringIncludes(html, '"@type":"Recipe"');
  assertStringIncludes(html, '"recipeYield":"4"');
  assertStringIncludes(html, '"totalTime":"PT80M"');
  assertStringIncludes(html, '"@type":"HowToStep","text":"Boil the potatoes."');
  assertStringIncludes(html, '"keywords":"hungarian, comfort"');
});

Deno.test('buildRecipePage is indexable and not a redirect', () => {
  const html = page();
  assertStringIncludes(html, 'name="robots" content="index,follow"');
  assert(!html.includes('noindex'));
  assert(!html.includes('http-equiv="refresh"'));
  assertStringIncludes(html, 'rel="canonical" href="https://app.example/r/tok123"');
  assertStringIncludes(
    html,
    'property="og:image" content="https://fns.example/public-recipe/tok123/og.png"',
  );
  assertStringIncludes(html, 'name="twitter:card" content="summary_large_image"');
});

Deno.test('buildRecipePage neutralises a script-laden title in body and JSON-LD', () => {
  const html = page({ title: '</script><script>alert(1)</script>' });
  assert(!html.includes('<script>alert(1)'));
  assertStringIncludes(html, '&lt;script&gt;alert(1)&lt;/script&gt;');
  assertStringIncludes(html, '\\u003c/script\\u003e\\u003cscript\\u003ealert(1)');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test -A --config supabase/functions/deno.json supabase/functions/public-recipe/meta_test.ts`
Expected: FAIL — `buildRecipePage` is not exported from `./meta.ts`.

- [ ] **Step 3: Rewrite `meta.ts`**

Replace the entire contents of `supabase/functions/public-recipe/meta.ts` with:

```ts
// Full server-rendered recipe page for non-browser clients (crawlers, AI
// agents, link unfurlers, CLI fetchers). Browsers get the SPA; this is the
// no-JavaScript representation — readable and indexable. Every interpolated
// value is user-controlled (recipe titles/steps/etc.) so escape all of it.

import { ingredientLine, recipeJsonLd, type ShareRecipe } from '../_shared/domain/share.ts';

export function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Serialise the JSON-LD object and neutralise the characters that could
// terminate or reopen the <script> element from inside a string value. A
// JSON-LD parser decodes < etc. back to the original characters.
function escapeJsonLd(value: Record<string, unknown>): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026');
}

export type RecipePageOpts = {
  recipe: ShareRecipe;
  householdName: string;
  description: string;
  canonicalUrl: string;
  ogImageUrl: string;
};

const PAGE_STYLE =
  'body{font-family:system-ui,sans-serif;max-width:42rem;margin:2rem auto;' +
  'padding:0 1rem;line-height:1.6;color:#2a1a2c}h1{font-size:1.8rem;' +
  'margin-bottom:.25rem}.attrib{color:#9a6a00;text-transform:uppercase;' +
  'letter-spacing:.1em;font-size:.75rem}li{margin:.35rem 0}';

export function buildRecipePage(opts: RecipePageOpts): string {
  const { recipe } = opts;
  const title = escapeHtml(recipe.title);
  const metaDescription = escapeHtml(opts.description);
  const canonical = escapeHtml(opts.canonicalUrl);
  const image = escapeHtml(opts.ogImageUrl);
  const household = escapeHtml(opts.householdName);
  const lang = escapeHtml(recipe.source_language || 'en');

  const jsonLd = escapeJsonLd(
    recipeJsonLd(recipe, {
      url: opts.canonicalUrl,
      imageUrl: opts.ogImageUrl,
      householdName: opts.householdName,
    }),
  );

  const ingredients = recipe.ingredients
    .map((ing) => `<li>${escapeHtml(ingredientLine(ing))}</li>`)
    .join('');
  const steps = recipe.steps.map((s) => `<li>${escapeHtml(s.body)}</li>`).join('');
  const tags =
    recipe.tags.length > 0
      ? `<p class="tags">${recipe.tags.map(escapeHtml).join(', ')}</p>`
      : '';
  const prose = recipe.description?.trim()
    ? `<p>${escapeHtml(recipe.description.trim())}</p>`
    : '';
  const source = recipe.source_url
    ? `<p>Source: <a href="${escapeHtml(recipe.source_url)}">${escapeHtml(recipe.source_url)}</a></p>`
    : '';

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<title>${title} — Dishton</title>
<meta name="description" content="${metaDescription}" />
<meta name="robots" content="index,follow" />
<link rel="canonical" href="${canonical}" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="Dishton" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${metaDescription}" />
<meta property="og:url" content="${canonical}" />
<meta property="og:image" content="${image}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${title}" />
<meta name="twitter:description" content="${metaDescription}" />
<meta name="twitter:image" content="${image}" />
<script type="application/ld+json">${jsonLd}</script>
<style>${PAGE_STYLE}</style>
</head>
<body>
<main>
<h1>${title}</h1>
<p class="attrib">From ${household}'s pantry</p>
${prose}
<p><a href="${canonical}">Open in Dishton →</a></p>
<h2>Ingredients</h2>
<ul>${ingredients}</ul>
<h2>Steps</h2>
<ol>${steps}</ol>
${tags}
${source}
</main>
</body>
</html>
`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test -A --config supabase/functions/deno.json supabase/functions/public-recipe/meta_test.ts`
Expected: PASS (5 tests green).

- [ ] **Step 5: Lint**

Run: `pnpm lint`
Expected: no errors. (Run `pnpm format` then re-run if Biome reports formatting in the rewritten files.)

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/public-recipe/meta.ts supabase/functions/public-recipe/meta_test.ts
git commit -m "feat(public-recipe): render full recipe page (JSON-LD + HTML), indexable"
```

---

## Task 3: Wire `index.ts` to the new builder

**Files:**
- Modify: `supabase/functions/public-recipe/index.ts`

- [ ] **Step 1: Update imports**

In `supabase/functions/public-recipe/index.ts`, change:

```ts
import { shareSummary } from '../_shared/domain/share.ts';
import { buildMetaHtml } from './meta.ts';
```

to:

```ts
import { shareSummary, type ShareRecipe } from '../_shared/domain/share.ts';
import { buildRecipePage } from './meta.ts';
```

- [ ] **Step 2: Narrow the payload type to the shared shape**

Replace:

```ts
type PublicRecipePayload = {
  recipe: {
    title: string;
    description: string | null;
    servings: number;
    total_time_min: number | null;
    hero_image_path: string | null;
    ingredients: unknown[];
  };
  household_name: string;
};
```

with:

```ts
type PublicRecipePayload = {
  recipe: ShareRecipe & { hero_image_path: string | null };
  household_name: string;
};
```

- [ ] **Step 3: Render the full page and drop the noindex header**

Replace the body of `handleMeta` from the `const html = buildMetaHtml({ ... });` call through the `return new Response(...)`:

```ts
  const html = buildMetaHtml({
    title: payload.recipe.title,
    description,
    canonicalUrl,
    ogImageUrl,
  });
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': CACHE_OK,
      'x-robots-tag': 'noindex',
    },
  });
```

with:

```ts
  const html = buildRecipePage({
    recipe: payload.recipe,
    householdName: payload.household_name,
    description,
    canonicalUrl,
    ogImageUrl,
  });
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': CACHE_OK,
    },
  });
```

- [ ] **Step 4: Type-check the function module**

Run: `deno check --config supabase/functions/deno.json supabase/functions/public-recipe/index.ts`
Expected: no errors. (`payload.recipe` now satisfies `ShareRecipe`; `factsLine`/`heroDataUri` still compile against the intersection type.)

- [ ] **Step 5: Re-run the edge tests + lint**

Run: `deno test -A --config supabase/functions/deno.json supabase/functions/public-recipe && pnpm lint`
Expected: PASS, no lint errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/public-recipe/index.ts
git commit -m "feat(public-recipe): serve buildRecipePage; drop noindex header"
```

---

## Task 4: Broaden the routing + lock it with a test

**Files:**
- Create: `src/lib/public-share-routing.test.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Write the failing routing test**

Create `src/lib/public-share-routing.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type Condition = { type: string; key: string; value: string };
type Rewrite = {
  source: string;
  destination: string;
  has?: Condition[];
  missing?: Condition[];
};

const config = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../vercel.json', import.meta.url)), 'utf8'),
) as { rewrites: Rewrite[] };

// vercel.json UA values use Go's inline (?i) flag; translate it to a JS 'i' flag.
function uaRegex(value: string): RegExp {
  return new RegExp(value.replace(/^\(\?i\)/, ''), 'i');
}

const shareRules = config.rewrites.filter((r) => r.source === '/r/:token');
const allow = uaRegex(shareRules.find((r) => r.has)?.has?.[0]?.value ?? '(?!)');
const browserish = uaRegex(shareRules.find((r) => r.missing)?.missing?.[0]?.value ?? '(?!)');

// Mirrors Vercel's first-match-wins evaluation: rule 1 fires when the UA
// matches the allowlist; rule 2 ("missing" mozilla) fires when the UA has no
// mozilla token. Either one sends the request to the Edge Function.
function routedToEdge(ua: string): boolean {
  return allow.test(ua) || !browserish.test(ua);
}

const BROWSERS: [string, string][] = [
  [
    'Chrome desktop',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  ],
  [
    'Safari iOS',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ],
  ['Firefox', 'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0'],
  [
    'Android Chrome',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
  ],
  [
    'LinkedIn in-app',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.0.0',
  ],
  [
    'Facebook in-app',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.0]',
  ],
  [
    'Instagram in-app',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 320.0.0.0',
  ],
];

const AGENTS: [string, string][] = [
  ['Googlebot', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
  [
    'GPTBot',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot',
  ],
  ['ChatGPT-User', 'Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com)'],
  ['ClaudeBot', 'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)'],
  ['PerplexityBot', 'Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)'],
  ['Bytespider', 'Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)'],
  ['Google-Extended', 'Mozilla/5.0 (compatible; Google-Extended/1.0)'],
  [
    'facebookexternalhit',
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  ],
  ['WhatsApp', 'WhatsApp/2.23.20.0'],
  ['curl', 'curl/8.6.0'],
  ['python-requests', 'python-requests/2.32.3'],
  ['empty UA', ''],
];

describe('public share /r/:token routing', () => {
  it.each(BROWSERS)('routes %s to the SPA', (name, ua) => {
    expect(routedToEdge(ua), name).toBe(false);
  });
  it.each(AGENTS)('routes %s to the Edge Function', (name, ua) => {
    expect(routedToEdge(ua), name).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/lib/public-share-routing.test.ts`
Expected: FAIL — the current `vercel.json` has only one `/r/:token` rule (no `missing` rule) and still carries bare social tokens, so the in-app-browser cases route to the Edge Function instead of the SPA.

- [ ] **Step 3: Replace the bot rewrite in `vercel.json` with two rules**

In `vercel.json`, replace this single object (the first entry of `rewrites`):

```json
    {
      "source": "/r/:token",
      "has": [
        {
          "type": "header",
          "key": "user-agent",
          "value": "(?i).*(bot|facebookexternalhit|whatsapp|slack|telegram|discord|twitter|linkedin|pinterest|skype|embedly|quora|vkshare|crawler|spider|preview).*"
        }
      ],
      "destination": "https://hdfpnxjxrcupuxrgrnpf.supabase.co/functions/v1/public-recipe/:token"
    },
```

with these two objects:

```json
    {
      "source": "/r/:token",
      "has": [
        {
          "type": "header",
          "key": "user-agent",
          "value": "(?i).*(bot|crawler|spider|facebookexternalhit|embedly|quora|vkshare|chatgpt|oai-searchbot|anthropic|claude|perplexity|google-extended|bytespider|cohere|gemini|bard).*"
        }
      ],
      "destination": "https://hdfpnxjxrcupuxrgrnpf.supabase.co/functions/v1/public-recipe/:token"
    },
    {
      "source": "/r/:token",
      "missing": [
        {
          "type": "header",
          "key": "user-agent",
          "value": "(?i).*mozilla.*"
        }
      ],
      "destination": "https://hdfpnxjxrcupuxrgrnpf.supabase.co/functions/v1/public-recipe/:token"
    },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/lib/public-share-routing.test.ts`
Expected: PASS — all browsers (incl. in-app webviews) → SPA; all agents → Edge Function.

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors. (`vercel.json` must remain valid comment-free JSON; run `pnpm format` if Biome reformats it.)

- [ ] **Step 6: Commit**

```bash
git add vercel.json src/lib/public-share-routing.test.ts
git commit -m "feat(routing): route non-browser UAs to the public-recipe edge page"
```

---

## Task 5: Documentation updates

**Files:**
- Modify: `docs/04-data-model.md`, `docs/15-roadmap-and-flags.md`, `docs/00-overview.md`, `docs/superpowers/specs/2026-06-11-public-recipe-share-design.md`

- [ ] **Step 1: `docs/04-data-model.md`** — replace the consumers bullet (lines 474-475):

```md
- Consumers: the SPA route `/r/$token` (anon supabase-js) and the
  `public-recipe` Edge Function (OG meta + card image for crawlers).
```

with:

```md
- Consumers: the SPA route `/r/$token` (anon supabase-js, for browsers) and
  the `public-recipe` Edge Function, which serves non-browser/unknown UAs a
  server-rendered, indexable recipe page (Schema.org `Recipe` JSON-LD +
  visible HTML + OG card). See
  `docs/superpowers/specs/2026-06-11-agent-readable-public-recipe-design.md`.
```

- [ ] **Step 2: `docs/15-roadmap-and-flags.md`** — replace lines 102-104:

```md
   `feature_flags.public_recipe_shares` row is a kill switch (default on:
   sharing is already opt-in per recipe). Spec:
   `docs/superpowers/specs/2026-06-11-public-recipe-share-design.md`.
```

with:

```md
   `feature_flags.public_recipe_shares` row is a kill switch (default on:
   sharing is already opt-in per recipe). Non-browser/agent UAs are routed to
   a server-rendered, indexable recipe page (Schema.org JSON-LD + visible
   HTML) so AI agents and crawlers can read the recipe without JavaScript
   (amended 2026-06). Specs:
   `docs/superpowers/specs/2026-06-11-public-recipe-share-design.md`,
   `docs/superpowers/specs/2026-06-11-agent-readable-public-recipe-design.md`.
```

- [ ] **Step 3: `docs/00-overview.md`** — replace lines 118-121:

```md
- Public/anonymous browsing of collections outside the follow model. (Opt-in,
  revocable single-recipe share links shipped 2026-06 as the sharing loop's
  landing surface; see
  `docs/superpowers/specs/2026-06-11-public-recipe-share-design.md`.)
```

with:

```md
- Public/anonymous browsing of collections outside the follow model. (Opt-in,
  revocable single-recipe share links shipped 2026-06 as the sharing loop's
  landing surface — made agent-readable and search-indexable 2026-06; see
  `docs/superpowers/specs/2026-06-11-public-recipe-share-design.md` and
  `docs/superpowers/specs/2026-06-11-agent-readable-public-recipe-design.md`.)
```

- [ ] **Step 4: `docs/superpowers/specs/2026-06-11-public-recipe-share-design.md`** — replace line 4:

```md
Status: approved for implementation (task-directed; amends doc 00 scope, see §9)
```

with:

```md
Status: approved for implementation (task-directed; amends doc 00 scope, see §9)

> Amended 2026-06-11 by
> `docs/superpowers/specs/2026-06-11-agent-readable-public-recipe-design.md`:
> the crawler page now serves the full recipe (Recipe JSON-LD + visible HTML),
> the bot rewrite is broadened to all non-browser UAs, and §2/§5/§8's
> `noindex` + meta-refresh are dropped (pages are now indexable).
```

- [ ] **Step 5: Commit**

```bash
git add docs/04-data-model.md docs/15-roadmap-and-flags.md docs/00-overview.md docs/superpowers/specs/2026-06-11-public-recipe-share-design.md
git commit -m "docs: public recipe pages are now agent-readable and indexable"
```

---

## Task 6: Full verification gate

**Files:** none (verification only).

- [ ] **Step 1: Run the full local gate**

Run each and confirm output:

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm exec vitest run src/lib/public-share-routing.test.ts
deno test -A --config supabase/functions/deno.json supabase/functions/public-recipe
```

Expected: typecheck clean; Biome clean; domain suite green; routing test green; edge suite green (`meta_test.ts` + `og_test.ts`).

- [ ] **Step 2: Build**

Run: `pnpm build`
Expected: `tsc -b` + `vite build` succeed (no new type or build errors).

- [ ] **Step 3: Commit any formatting fixups (only if `pnpm format` changed files)**

```bash
git add -A && git commit -m "chore: formatting" || echo "nothing to commit"
```

---

## Task 7: Visual validation

**Files:** none (validation only). Invoke the `validating-features-visually` skill — it is authoritative for the local Supabase + `pnpm preview` + Playwright procedure inside the sandbox.

- [ ] **Step 1: SPA path unchanged for browsers**

Per the skill: boot local Supabase (`supabase start -x edge-runtime,functions`), `pnpm build && pnpm preview`, then drive Playwright to `/r/a1b2c3d4e5f60718293a4b5c6d7e8f90` (the seeded Tarte Tatin token) at desktop (1280×800) and mobile (390×844). Confirm the interactive SPA still renders (hero, ingredients, servings scaler, unit toggle) — a real-browser UA must NOT get the static edge page.

- [ ] **Step 2: Edge page renders for agents**

The local stack can't run Edge Functions (CLAUDE.md), so render the page from the builder to a static file and screenshot it:

```bash
deno eval -A '
import { buildRecipePage } from "./supabase/functions/public-recipe/meta.ts";
const html = buildRecipePage({
  recipe: { title: "Rakott Krumpli", description: "Hungarian layered potato casserole.", servings: 4, total_time_min: 80, source_url: "https://example.com/rakott", source_language: "en", tags: ["hungarian","comfort"], ingredients: [{ raw_text: "800g waxy potatoes", ingredient_name: "waxy potatoes", quantity: 800, unit: "g", notes: null }], steps: [{ body: "Boil the potatoes.", position: 0 }] },
  householdName: "My Recipes",
  description: "4 servings · 80 min · 1 ingredient",
  canonicalUrl: "https://dishton.vercel.app/r/demo",
  ogImageUrl: "https://dishton.vercel.app/icons/og-default.png",
});
await Deno.writeTextFile("/tmp/edge-recipe.html", html);
console.log("wrote /tmp/edge-recipe.html");
'
```

Open `/tmp/edge-recipe.html` in Playwright and screenshot at desktop + mobile. Confirm: visible `<h1>`, ingredients `<ul>`, steps `<ol>`, "Open in Dishton" link, and (via `view-source` or a DOM check) the `application/ld+json` block. Validate the JSON-LD with a quick parse (it must be valid JSON).

- [ ] **Step 3: Optional sanity check against the live deployed function**

After merge/deploy, fetch the deployed edge URL with a non-browser UA to confirm production parity:

```bash
curl -A 'curl/8.6.0' -s 'https://hdfpnxjxrcupuxrgrnpf.supabase.co/functions/v1/public-recipe/<live-token>' | head -40
```

Expected: full recipe HTML with `index,follow`, no `http-equiv="refresh"`, and a `Recipe` JSON-LD block.

- [ ] **Step 4: Push the branch**

```bash
git push -u origin claude/cool-meitner-nyqz3r
```

---

## Notes for the implementer

- **No DB/RPC/secret/migration changes.** `get_public_recipe` already returns `steps`, `tags`, `source_url`, `source_language` — this plan only consumes them. The migration-diff CI check must stay green (no schema change).
- **The `_shared/domain` symlink** resolves `../_shared/domain/share.ts` to `src/domain/share.ts`. Don't break it; the deploy workflow swaps it for a real copy.
- **`vercel.json` is comment-free JSON** — the `//` comments in the spec are illustrative only; never put them in the file.
- **`\\u003c` in `meta.ts` is intentional**: the source literal `'\\u003c'` is the six characters `<` emitted into the JSON-LD, which a parser decodes back to `<`.
