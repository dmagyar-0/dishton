# Public Shareable Recipe Page + OG Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opt-in public share links for single recipes (`/r/<token>`), with a public read-only SPA page and crawler-facing OG meta + generated OG image, per `docs/superpowers/specs/2026-06-11-public-recipe-share-design.md`.

**Architecture:** A `recipe_shares` table (token = the secret) + a SECURITY DEFINER RPC `get_public_recipe(token)` as the single anon read path. Humans get a guard-less SPA route; crawlers are rewritten by `vercel.json` (User-Agent match) to a new `public-recipe` Edge Function that renders OG meta HTML and a Satori-generated 1200×630 PNG.

**Tech Stack:** Postgres/RLS migration + psql TAP tests, Deno Edge Function (`og_edge` for the image), TanStack Router/Query SPA route, Vitest component tests.

---

### Task 1: Domain helper `src/domain/share.ts`

**Files:**
- Create: `src/domain/share.ts`
- Create: `src/domain/share.test.ts`
- Modify: `src/domain/index.ts` (re-export, follow the file's existing export list style)

- [x] **Step 1: Write the failing tests**

```ts
// src/domain/share.test.ts
import { describe, expect, it } from 'vitest';
import { sharePath, shareSummary } from './share';

describe('sharePath', () => {
  it('builds the public route path from a token', () => {
    expect(sharePath('abc123')).toBe('/r/abc123');
  });
});

describe('shareSummary', () => {
  it('prefers the recipe description when present', () => {
    expect(
      shareSummary({
        description: 'A savoury upside-down pastry.',
        servings: 4,
        total_time_min: 55,
        ingredientCount: 3,
      }),
    ).toBe('A savoury upside-down pastry.');
  });

  it('truncates long descriptions to 160 chars on a word boundary with an ellipsis', () => {
    const long = `${'word '.repeat(60)}end`;
    const out = shareSummary({
      description: long,
      servings: 4,
      total_time_min: null,
      ingredientCount: 1,
    });
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/\s…$/);
  });

  it('falls back to a facts line without a description', () => {
    expect(
      shareSummary({ description: null, servings: 4, total_time_min: 55, ingredientCount: 9 }),
    ).toBe('4 servings · 55 min · 9 ingredients');
  });

  it('singularises and omits missing time', () => {
    expect(
      shareSummary({ description: '', servings: 1, total_time_min: null, ingredientCount: 1 }),
    ).toBe('1 serving · 1 ingredient');
  });
});
```

- [x] **Step 2: Run to verify failure** — `pnpm vitest run src/domain/share.test.ts` → FAIL (module not found).

- [x] **Step 3: Implement**

```ts
// src/domain/share.ts
// Pure helpers for the public share surface. No React, no I/O — imported by
// the SPA and by the public-recipe Edge Function via the _shared/domain symlink.

export function sharePath(token: string): string {
  return `/r/${token}`;
}

export type ShareSummaryInput = {
  description: string | null;
  servings: number;
  total_time_min: number | null;
  ingredientCount: number;
};

const MAX_SUMMARY = 160;

// One-line summary for OG descriptions: the recipe's own description when it
// has one (truncated to MAX_SUMMARY on a word boundary), otherwise a
// "4 servings · 55 min · 9 ingredients" facts line.
export function shareSummary(input: ShareSummaryInput): string {
  const desc = input.description?.trim();
  if (desc) {
    if (desc.length <= MAX_SUMMARY) return desc;
    const cut = desc.slice(0, MAX_SUMMARY - 1);
    const lastSpace = cut.lastIndexOf(' ');
    return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
  }
  const parts = [`${input.servings} ${input.servings === 1 ? 'serving' : 'servings'}`];
  if (input.total_time_min != null && input.total_time_min > 0) {
    parts.push(`${input.total_time_min} min`);
  }
  parts.push(`${input.ingredientCount} ${input.ingredientCount === 1 ? 'ingredient' : 'ingredients'}`);
  return parts.join(' · ');
}
```

Re-export from `src/domain/index.ts` alongside the existing exports.

- [x] **Step 4: Run** `pnpm vitest run src/domain/share.test.ts` → PASS.
- [x] **Step 5: Commit** `feat(domain): share path + OG summary helpers`

---

### Task 2: Migration — `recipe_shares` table, RPC, storage branch, flag row

**Files:**
- Create: `supabase/migrations/20260611120000_recipe_shares.sql`
- Create: `supabase/tests/recipe_shares.test.sql`
- Modify: `supabase/seed.sql` (share row + flag row)

- [x] **Step 1: Write the migration**

```sql
-- 20260611120000_recipe_shares.sql
-- Opt-in public share links for single recipes.
-- Defined by docs/superpowers/specs/2026-06-11-public-recipe-share-design.md
-- and docs/04-data-model.md. The token is the access secret: 128-bit random,
-- hex-encoded. Row exists <=> link is live; revoke = delete the row.

set search_path = public;

create table app.recipe_shares (
  recipe_id  uuid primary key references app.recipes(id) on delete cascade,
  token      text not null unique default encode(gen_random_bytes(16), 'hex'),
  created_by uuid references app.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table app.recipe_shares enable row level security;

-- Members see share status for their household's recipes. Followers and anon
-- see nothing — the token itself is the only public handle.
create policy recipe_shares_member_read on app.recipe_shares
  for select using (
    exists (
      select 1 from app.recipes r
      where r.id = recipe_id and app.is_household_member(r.household_id)
    )
  );

create policy recipe_shares_editor_insert on app.recipe_shares
  for insert with check (app.is_recipe_editor(recipe_id));

create policy recipe_shares_editor_delete on app.recipe_shares
  for delete using (app.is_recipe_editor(recipe_id));

-- No UPDATE policy: toggling re-creates the row (fresh token).
grant select, insert, delete on app.recipe_shares to authenticated;

------------------------------------------------------------------------------
-- Public read path. SECURITY DEFINER so anon can read exactly this whitelisted
-- projection and nothing else. Returns null for unknown tokens and when the
-- public_recipe_shares kill switch is off.
------------------------------------------------------------------------------

create or replace function app.get_public_recipe(share_token text)
returns jsonb
language plpgsql stable security definer
set search_path = app, public
as $$
declare
  v_recipe_id uuid;
  v_enabled boolean;
  result jsonb;
begin
  select enabled into v_enabled
    from app.feature_flags where key = 'public_recipe_shares';
  if not coalesce(v_enabled, false) then return null; end if;

  select recipe_id into v_recipe_id
    from app.recipe_shares where token = share_token;
  if v_recipe_id is null then return null; end if;

  select jsonb_build_object(
    'recipe', jsonb_build_object(
      'title', r.title,
      'description', r.description,
      'source_type', r.source_type,
      'source_url', r.source_url,
      'source_language', r.source_language,
      'canonical_unit_system', r.canonical_unit_system,
      'servings', r.servings,
      'total_time_min', r.total_time_min,
      'hero_image_path', r.hero_image_path,
      'tags', coalesce(
        (select jsonb_agg(t.tag order by t.tag)
           from app.recipe_tags t where t.recipe_id = r.id),
        '[]'::jsonb),
      'ingredients', coalesce(
        (select jsonb_agg(jsonb_build_object(
            'position', i.position,
            'raw_text', i.raw_text,
            'quantity', i.quantity,
            'unit', i.unit,
            'ingredient_name', i.ingredient_name,
            'notes', i.notes,
            'section', i.section) order by i.position)
           from app.recipe_ingredients i where i.recipe_id = r.id),
        '[]'::jsonb),
      'steps', coalesce(
        (select jsonb_agg(jsonb_build_object(
            'position', s.position,
            'body', s.body,
            'duration_min', s.duration_min) order by s.position)
           from app.recipe_steps s where s.recipe_id = r.id),
        '[]'::jsonb)
    ),
    'household_name', h.name
  ) into result
  from app.recipes r
  join app.households h on h.id = r.household_id
  where r.id = v_recipe_id;

  return result;
end;
$$;

revoke all on function app.get_public_recipe(text) from public;
grant execute on function app.get_public_recipe(text)
  to anon, authenticated, service_role;

------------------------------------------------------------------------------
-- Storage: let anyone holding a live share link load the hero image. The
-- bucket stays private; this adds one branch keyed on share-row existence to
-- the existing read policy (recreated verbatim from
-- 20260430120900_storage_policies.sql plus the new branch).
------------------------------------------------------------------------------

drop policy if exists recipe_images_read on storage.objects;
create policy recipe_images_read on storage.objects
  for select to anon, authenticated using (
    bucket_id = 'recipe-images'
    and (
      exists (
        select 1 from app.recipes r
        where r.hero_image_path = storage.objects.name
          and (app.is_household_member(r.household_id)
               or app.is_household_follower(r.household_id))
      )
      or (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from app.recipes r
        join app.recipe_shares s on s.recipe_id = r.id
        where r.hero_image_path = storage.objects.name
      )
    )
  );

------------------------------------------------------------------------------
-- Kill-switch flag (runtime, per docs/15-roadmap-and-flags.md). Enabled by
-- default: the feature is opt-in per recipe; the flag exists to turn the
-- public surface off in one update without deleting share rows.
------------------------------------------------------------------------------

insert into app.feature_flags (key, enabled, rollout_percent)
values ('public_recipe_shares', true, 100)
on conflict (key) do nothing;
```

- [x] **Step 2: Write the DB tests** (`supabase/tests/recipe_shares.test.sql`, modelled on `rls.test.sql`: fixtures, `pg_temp` persona helpers via `set_config('role', ...)`, `_t_results` temp table emitted as the final SELECT). Personas: A = owner of H1 (has the recipe), B = editor H1, C = owner H2 (H1 follows H2 — so C is a *follower-of-nothing* relative to H1; use a separate unrelated D for non-member). Assertions:
  1. `editor B can insert a share for an H1 recipe` (insert returns rowcount 1)
  2. `member A can read the share token` (select count = 1)
  3. `unrelated D sees no share rows` (count = 0)
  4. `anon role cannot select recipe_shares` (DO block catching `insufficient_privilege` → ok)
  5. `anon get_public_recipe returns the whitelisted payload` (run with `set_config('role','anon',true)`; check `payload->'recipe'->>'title'`, `payload->>'household_name'`, `jsonb_array_length(payload->'recipe'->'ingredients')`)
  6. `payload exposes no ids` (`payload->'recipe' ?| array['id','household_id','created_by'] = false`)
  7. `unknown token returns null`
  8. `deleting the share row kills the token` (delete as editor, RPC → null)
  9. `flag off returns null` (update `app.feature_flags` set enabled=false, RPC → null; transaction rollback restores)
  10. Storage branch: insert a row into `storage.objects` (`bucket_id='recipe-images'`, `name='00000000-.../hero.jpg'`), point the recipe's `hero_image_path` at it; as anon, `select count(*) from storage.objects where name = ...` = 1 with a live share and = 0 after the share row is deleted.

- [x] **Step 3: Run** `pnpm test:db` (requires the local stack's Postgres on 54322 — start Docker + `supabase start -x edge-runtime,functions` per the validating-features-visually skill if not running). Expected: new file's assertions all `ok`, existing files stay green (watch `production_readiness.test.sql` and `security_hardening.test.sql` for grant/policy inventory assertions that may need the new objects added).

- [x] **Step 4: Seed** — append to `supabase/seed.sql`:

```sql
-- Deterministic public share for the Tomato Tarte Tatin so local visual
-- validation and E2E can hit /r/<token> without UI setup.
insert into app.recipe_shares (recipe_id, token, created_by) values
  ('33333333-3333-3333-3333-333333333333',
   'a1b2c3d4e5f60718293a4b5c6d7e8f90',
   '00000000-0000-0000-0000-000000000001')
on conflict (recipe_id) do nothing;
```

and add `('public_recipe_shares', true, 100)` to the existing feature-flags insert list.

- [x] **Step 5: Add types** — in `src/lib/database.types.ts` add `recipe_shares: GenericTable;` to the `Tables` map and to `Functions`:

```ts
      get_public_recipe: { Args: { share_token: string }; Returns: Json };
```

- [x] **Step 6: Commit** `feat(db): recipe_shares table, get_public_recipe RPC, shared-hero storage branch`

---

### Task 3: Feature flag registration

**Files:**
- Modify: `src/feature-flags/registry.ts`

- [x] **Step 1:** Append to `FLAGS`:

```ts
  {
    key: 'public_recipe_shares',
    transport: 'runtime',
    description:
      'Kill switch for public recipe share links: gates the Share button and all anon reads via get_public_recipe.',
    ownerDoc: 'docs/15-roadmap-and-flags.md',
  },
```

- [x] **Step 2:** `pnpm typecheck` → PASS. Commit `feat(flags): public_recipe_shares runtime flag` (doc-15 table row lands in Task 10 — the CI doc/registry sync check runs on the full branch, keep both in the same PR).

---

### Task 4: Edge Function `public-recipe` — meta HTML (pure builder + tests)

**Files:**
- Create: `supabase/functions/public-recipe/meta.ts`
- Create: `supabase/functions/public-recipe/meta_test.ts`

- [x] **Step 1: Failing tests**

```ts
// supabase/functions/public-recipe/meta_test.ts
import { assert, assertEquals } from '@std/assert';
import { buildMetaHtml, escapeHtml } from './meta.ts';

Deno.test('escapeHtml neutralises markup-significant characters', () => {
  assertEquals(
    escapeHtml(`<script>alert("x&y'")</script>`),
    '&lt;script&gt;alert(&quot;x&amp;y&#39;&quot;)&lt;/script&gt;',
  );
});

Deno.test('buildMetaHtml escapes user content and carries the OG essentials', () => {
  const html = buildMetaHtml({
    title: '<script>Tarte</script>',
    description: 'Tomatoes & pastry',
    canonicalUrl: 'https://app.example/r/tok123',
    ogImageUrl: 'https://fns.example/public-recipe/tok123/og.png',
  });
  assert(!html.includes('<script>'));
  assert(html.includes('&lt;script&gt;Tarte&lt;/script&gt;'));
  assert(html.includes('Tomatoes &amp; pastry'));
  assert(html.includes('property="og:image" content="https://fns.example/public-recipe/tok123/og.png"'));
  assert(html.includes('property="og:url" content="https://app.example/r/tok123"'));
  assert(html.includes('name="twitter:card" content="summary_large_image"'));
  assert(html.includes('name="robots" content="noindex"'));
  assert(html.includes('http-equiv="refresh"'));
  assert(html.includes('rel="canonical" href="https://app.example/r/tok123"'));
});
```

- [x] **Step 2:** `pnpm test:edge` (or `deno test -A --config supabase/functions/deno.json supabase/functions/public-recipe/`) → FAIL (module not found).

- [x] **Step 3: Implement**

```ts
// supabase/functions/public-recipe/meta.ts
// Pure OG meta-document builder for crawler traffic. Every interpolated value
// is user-controlled (recipe titles/descriptions) — escape all of it.

export function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export type MetaHtmlOpts = {
  title: string;
  description: string;
  canonicalUrl: string;
  ogImageUrl: string;
};

export function buildMetaHtml(opts: MetaHtmlOpts): string {
  const title = escapeHtml(opts.title);
  const description = escapeHtml(opts.description);
  const canonical = escapeHtml(opts.canonicalUrl);
  const image = escapeHtml(opts.ogImageUrl);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${title} — Dishton</title>
<meta name="description" content="${description}" />
<meta name="robots" content="noindex" />
<link rel="canonical" href="${canonical}" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="Dishton" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${description}" />
<meta property="og:url" content="${canonical}" />
<meta property="og:image" content="${image}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${title}" />
<meta name="twitter:description" content="${description}" />
<meta name="twitter:image" content="${image}" />
<meta http-equiv="refresh" content="0;url=${canonical}" />
</head>
<body>
<p><a href="${canonical}">${title}</a></p>
</body>
</html>
`;
}
```

- [x] **Step 4:** Tests PASS. **Step 5: Commit** `feat(edge): public-recipe OG meta builder`

---

### Task 5: Edge Function `public-recipe` — OG card element + tests

**Files:**
- Create: `supabase/functions/public-recipe/og.ts`
- Create: `supabase/functions/public-recipe/og_test.ts`

- [x] **Step 1: Failing tests**

```ts
// supabase/functions/public-recipe/og_test.ts
import { assert, assertEquals } from '@std/assert';
import { buildOgElement, type OgElement } from './og.ts';

function flatten(el: OgElement, acc: OgElement[] = []): OgElement[] {
  acc.push(el);
  const children = el.props.children;
  const arr = Array.isArray(children) ? children : children != null ? [children] : [];
  for (const c of arr) {
    if (c && typeof c === 'object' && 'type' in c) flatten(c as OgElement, acc);
  }
  return acc;
}

Deno.test('og card with a hero image splits into text + image panes', () => {
  const el = buildOgElement({
    title: 'Tomato Tarte Tatin',
    householdName: 'The Pantry',
    metaLine: '4 servings · 55 min · 3 ingredients',
    heroSrc: 'data:image/jpeg;base64,abc',
  });
  const nodes = flatten(el);
  assert(nodes.some((n) => n.type === 'img' && n.props.src === 'data:image/jpeg;base64,abc'));
  const texts = nodes.flatMap((n) =>
    typeof n.props.children === 'string' ? [n.props.children] : [],
  );
  assert(texts.includes('Tomato Tarte Tatin'));
  assert(texts.some((t) => t.includes('The Pantry')));
  assert(texts.includes('4 servings · 55 min · 3 ingredients'));
  assert(texts.includes('Dishton'));
});

Deno.test('og card without a hero renders no img node', () => {
  const el = buildOgElement({
    title: 'Limoncello',
    householdName: "Carol's Kitchen",
    metaLine: '12 servings · 1440 min · 3 ingredients',
    heroSrc: null,
  });
  assertEquals(flatten(el).some((n) => n.type === 'img'), false);
});
```

- [x] **Step 2:** Run → FAIL. **Step 3: Implement**

```ts
// supabase/functions/public-recipe/og.ts
// Builds the 1200x630 OG card as a plain React-shaped element tree (Satori
// accepts {type, props} objects — no React import needed). Editorial Pantry
// palette: paper #f5efe3, ink #2a1a2c, saffron #e08a1a.

export type OgElement = {
  type: string;
  props: Record<string, unknown> & { children?: unknown };
};

function el(
  type: string,
  props: Record<string, unknown>,
  ...children: (OgElement | string)[]
): OgElement {
  return {
    type,
    props: { ...props, children: children.length === 1 ? children[0] : children },
  };
}

export type OgCardData = {
  title: string;
  householdName: string;
  metaLine: string;
  // Data URI (or https URL) for the hero photo; null renders the text-only layout.
  heroSrc: string | null;
};

export function buildOgElement(data: OgCardData): OgElement {
  const textPane = el(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        flexGrow: 1,
        flexShrink: 1,
        padding: '56px 60px',
      },
    },
    el(
      'div',
      { style: { display: 'flex', flexDirection: 'column' } },
      el(
        'div',
        {
          style: {
            fontSize: 26,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: '#e08a1a',
            fontFamily: 'mono, monospace',
          },
        },
        `From ${data.householdName}`,
      ),
      el(
        'div',
        {
          style: {
            fontSize: data.title.length > 60 ? 52 : 68,
            lineHeight: 1.1,
            color: '#2a1a2c',
            marginTop: 24,
            fontWeight: 600,
          },
        },
        data.title,
      ),
      el(
        'div',
        { style: { fontSize: 30, color: '#6b5a6e', marginTop: 28 } },
        data.metaLine,
      ),
    ),
    el(
      'div',
      { style: { display: 'flex', alignItems: 'center' } },
      el(
        'div',
        {
          style: {
            fontSize: 34,
            color: '#2a1a2c',
            fontWeight: 600,
            borderBottom: '4px solid #e08a1a',
            paddingBottom: 4,
          },
        },
        'Dishton',
      ),
    ),
  );

  const children: OgElement[] = [textPane];
  if (data.heroSrc) {
    children.push(
      el('img', {
        src: data.heroSrc,
        width: 480,
        height: 630,
        style: { width: 480, height: 630, objectFit: 'cover', flexShrink: 0 },
      }),
    );
  }

  return el(
    'div',
    {
      style: {
        width: 1200,
        height: 630,
        display: 'flex',
        flexDirection: 'row',
        backgroundColor: '#f5efe3',
      },
    },
    ...children,
  );
}
```

- [x] **Step 4:** Tests PASS. **Step 5: Commit** `feat(edge): public-recipe OG card layout`

---

### Task 6: Edge Function `public-recipe` — handler + config

**Files:**
- Create: `supabase/functions/public-recipe/index.ts`
- Modify: `supabase/config.toml` (verify_jwt = false block)

- [x] **Step 1: Implement the handler**

```ts
// public-recipe: unauthenticated GET surface for the share loop.
//   GET /public-recipe/<token>          -> OG meta HTML (crawlers; humans get
//                                          a meta-refresh to /r/<token>)
//   GET /public-recipe/<token>/og.png   -> 1200x630 OG card PNG (Satori)
// verify_jwt is off (supabase/config.toml): the token in the path is the
// credential; reads go through the same get_public_recipe RPC as the SPA.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { shareSummary } from '../_shared/domain/share.ts';
import { buildMetaHtml } from './meta.ts';
import { buildOgElement } from './og.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
// Canonical app origin for og:url / redirects. Override in prod via
// `supabase secrets set PUBLIC_APP_ORIGIN=https://<app-domain>`.
const APP_ORIGIN = Deno.env.get('PUBLIC_APP_ORIGIN') ?? 'https://dishton.vercel.app';

const CACHE_OK = 'public, max-age=300, s-maxage=3600';

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

let _admin: ReturnType<typeof createClient<unknown, 'app'>> | null = null;
function adminClient() {
  if (_admin === null) {
    _admin = createClient<unknown, 'app'>(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
      db: { schema: 'app' },
    });
  }
  return _admin;
}

function notFound(): Response {
  return new Response(JSON.stringify({ error: 'not_found' }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });
}

async function loadPayload(token: string): Promise<PublicRecipePayload | null> {
  const { data, error } = await adminClient().rpc('get_public_recipe', { share_token: token });
  if (error) throw new Error(`get_public_recipe failed: ${error.message}`);
  return (data ?? null) as PublicRecipePayload | null;
}

// Resolve the hero to a data URI Satori can embed: remote URLs are fetched,
// bucket paths are downloaded with the service role. Failures degrade to the
// text-only card.
async function heroDataUri(path: string | null): Promise<string | null> {
  if (!path) return null;
  try {
    let bytes: ArrayBuffer;
    let mime: string;
    if (/^https?:\/\//i.test(path)) {
      const res = await fetch(path);
      if (!res.ok) return null;
      mime = res.headers.get('content-type') ?? 'image/jpeg';
      bytes = await res.arrayBuffer();
    } else {
      const dl = await adminClient().storage.from('recipe-images').download(path);
      if (dl.error || !dl.data) return null;
      mime = dl.data.type || 'image/jpeg';
      bytes = await dl.data.arrayBuffer();
    }
    if (bytes.byteLength > 4_000_000) return null;
    return `data:${mime};base64,${encodeBase64(bytes)}`;
  } catch {
    return null;
  }
}

// Fraunces for the card. Satori takes ttf/otf/woff (not woff2); fontsource's
// .woff build works. Cached for the worker lifetime; null = default font.
let _font: ArrayBuffer | null | undefined;
async function loadFont(): Promise<ArrayBuffer | null> {
  if (_font !== undefined) return _font;
  try {
    const res = await fetch(
      'https://cdn.jsdelivr.net/npm/@fontsource/fraunces@5.0.13/files/fraunces-latin-600-normal.woff',
    );
    _font = res.ok ? await res.arrayBuffer() : null;
  } catch {
    _font = null;
  }
  return _font;
}

function metaLine(payload: PublicRecipePayload): string {
  return shareSummary({
    description: payload.recipe.description,
    servings: payload.recipe.servings,
    total_time_min: payload.recipe.total_time_min,
    ingredientCount: payload.recipe.ingredients.length,
  });
}

async function handleOgImage(token: string, payload: PublicRecipePayload): Promise<Response> {
  // Dynamic import keeps the (wasm-heavy) renderer off the meta path.
  const { ImageResponse } = await import('https://deno.land/x/og_edge@0.0.6/mod.ts');
  const hero = await heroDataUri(payload.recipe.hero_image_path);
  const font = await loadFont();
  const element = buildOgElement({
    title: payload.recipe.title,
    householdName: payload.household_name,
    metaLine: shareSummary({
      description: null, // the card always shows the facts line, not prose
      servings: payload.recipe.servings,
      total_time_min: payload.recipe.total_time_min,
      ingredientCount: payload.recipe.ingredients.length,
    }),
    heroSrc: hero,
  });
  // deno-lint-ignore no-explicit-any
  return new ImageResponse(element as any, {
    width: 1200,
    height: 630,
    fonts: font
      ? [{ name: 'Fraunces', data: font, weight: 600 as const, style: 'normal' as const }]
      : undefined,
    headers: { 'cache-control': CACHE_OK },
  });
}

function handleMeta(token: string, payload: PublicRecipePayload): Response {
  const canonicalUrl = `${APP_ORIGIN}/r/${token}`;
  const ogImageUrl = `${SUPABASE_URL}/functions/v1/public-recipe/${token}/og.png`;
  const html = buildMetaHtml({
    title: payload.recipe.title,
    description: metaLine(payload),
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
}

serve(async (req: Request) => {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { allow: 'GET', 'content-type': 'application/json' },
    });
  }
  // Path inside the function: /public-recipe/<token>[/og.png]
  const segments = new URL(req.url).pathname.split('/').filter(Boolean);
  const fnIdx = segments.indexOf('public-recipe');
  const token = segments[fnIdx + 1];
  const tail = segments[fnIdx + 2];
  if (!token || !/^[0-9a-f]{16,64}$/.test(token) || (tail && tail !== 'og.png')) {
    return notFound();
  }

  try {
    const payload = await loadPayload(token);
    if (!payload) return notFound();
    return tail === 'og.png' ? await handleOgImage(token, payload) : handleMeta(token, payload);
  } catch (e) {
    console.error('public-recipe error', (e as Error).message);
    return new Response(JSON.stringify({ error: 'internal' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
});
```

Note: the seed token is hex; the column default produces 32 hex chars. The `/^[0-9a-f]{16,64}$/` check rejects junk paths early.

- [x] **Step 2:** Append to `supabase/config.toml`:

```toml
# Public share surface: the share token in the path is the credential, and the
# function only reads via the get_public_recipe definer RPC. Crawlers (and the
# vercel.json rewrite) call it with no Supabase JWT, so the gateway must not 401.
[functions.public-recipe]
verify_jwt = false
```

- [x] **Step 3:** `pnpm test:edge` stays green (index.ts is exercised manually/visually; the pure parts are covered by Tasks 4–5). `deno check` it: `deno check --config supabase/functions/deno.json supabase/functions/public-recipe/index.ts`.
- [x] **Step 4: Commit** `feat(edge): public-recipe meta + og.png handler`

---

### Task 7: SPA share queries + public-recipe query

**Files:**
- Create: `src/lib/queries/shares.ts`

- [x] **Step 1: Implement** (typecheck-driven; behaviour is covered by the component tests in Tasks 8–9 and the DB tests)

```ts
// src/lib/queries/shares.ts
// Share-link management (members/editors) + the anon public read path.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import { RECIPE_IMAGES_BUCKET, isRemoteImageUrl } from './storage';

export type RecipeShare = { token: string };

export function useRecipeShare(recipeId: string) {
  return useQuery({
    queryKey: ['recipe-share', recipeId],
    queryFn: async (): Promise<RecipeShare | null> => {
      const { data, error } = await supabase
        .from('recipe_shares')
        .select('token')
        .eq('recipe_id', recipeId)
        .maybeSingle();
      if (error) throw error;
      return (data as RecipeShare | null) ?? null;
    },
  });
}

export function useEnableShare(recipeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<RecipeShare> => {
      const { data, error } = await supabase
        .from('recipe_shares')
        .insert({ recipe_id: recipeId })
        .select('token')
        .single();
      if (error) throw error;
      return data as RecipeShare;
    },
    onSuccess: (share) => {
      qc.setQueryData(['recipe-share', recipeId], share);
    },
  });
}

export function useDisableShare(recipeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('recipe_shares').delete().eq('recipe_id', recipeId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.setQueryData(['recipe-share', recipeId], null);
    },
  });
}

// ---------------------------------------------------------------------------
// Public (anon-capable) reads
// ---------------------------------------------------------------------------

export type PublicRecipePayload = {
  recipe: {
    title: string;
    description: string | null;
    source_type: 'url' | 'instagram' | 'photo' | 'manual';
    source_url: string | null;
    source_language: string;
    canonical_unit_system: 'metric' | 'imperial';
    servings: number;
    total_time_min: number | null;
    hero_image_path: string | null;
    tags: string[];
    ingredients: {
      position: number;
      raw_text: string;
      quantity: import('@/domain').Quantity | null;
      unit: string | null;
      ingredient_name: string | null;
      notes: string | null;
      section: string | null;
    }[];
    steps: { position: number; body: string; duration_min: number | null }[];
  };
  household_name: string;
};

export function usePublicRecipe(token: string) {
  return useQuery({
    queryKey: ['public-recipe', token],
    queryFn: async (): Promise<PublicRecipePayload | null> => {
      const { data, error } = await supabase.rpc('get_public_recipe', { share_token: token });
      if (error) throw error;
      return (data ?? null) as PublicRecipePayload | null;
    },
    staleTime: 60_000,
  });
}

// Hero loader that works for anon viewers: signed URLs require an
// authenticated session, but a direct download passes the share-keyed storage
// RLS branch with the anon key. Remote (imported) heroes are used verbatim.
export function usePublicHeroImage(path: string | null): string | null {
  const q = useQuery({
    queryKey: ['public-hero', path ?? null],
    enabled: path != null && path !== '',
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async (): Promise<string | null> => {
      if (!path) return null;
      if (isRemoteImageUrl(path)) return path;
      const { data, error } = await supabase.storage.from(RECIPE_IMAGES_BUCKET).download(path);
      if (error || !data) return null;
      return URL.createObjectURL(data);
    },
  });
  if (path && isRemoteImageUrl(path)) return path;
  return q.data ?? null;
}
```

- [x] **Step 2:** `pnpm typecheck` → PASS. **Step 3: Commit** `feat(spa): share-link queries + public recipe read path`

---

### Task 8: Extract shared display pipeline, then ShareDialog + detail-page button

**Files:**
- Create: `src/lib/recipe-display.ts` (move `toDomainRecipe` + `resolveDisplay` out of the detail route, exported; the route imports them — no behaviour change)
- Create: `src/ui/recipe/ShareDialog.tsx`
- Create: `src/ui/recipe/ShareDialog.test.tsx`
- Modify: `src/routes/h/$householdId/r/$recipeId/index.tsx` (import the extracted helpers; add Share button)
- Modify: `src/lib/i18n.en.ts`, `src/lib/i18n.de.ts` (new `share` namespace)

- [x] **Step 1: Extract** `toDomainRecipe(full, sourceIngredients?)` and `resolveDisplay(...)` into `src/lib/recipe-display.ts` verbatim (generalise the ingredient/step row types so the public payload's id-less rows fit):

```ts
// src/lib/recipe-display.ts
// The scale+convert display pipeline shared by the household recipe detail
// page and the public share page. Pure mapping over domain functions.

import type { Quantity, Recipe } from '@/domain';
import {
  convert,
  niceQuantity,
  pickDisplayUnit,
  quantityIsEmpty,
  quantityToNumber,
} from '@/domain';

export type DisplayableIngredientRow = {
  position: number;
  raw_text: string;
  quantity: Quantity | null;
  unit: string | null;
  ingredient_name: string | null;
  notes: string | null;
  section: string | null;
};

export type DisplayableStepRow = { position: number; body: string; duration_min: number | null };

export type DisplayableRecipe = {
  recipe: {
    title: string;
    description: string | null;
    source_type: Recipe['source_type'];
    source_url: string | null;
    source_language: string;
    canonical_unit_system: 'metric' | 'imperial';
    servings: number;
    total_time_min: number | null;
    hero_image_path: string | null;
  };
  ingredients: DisplayableIngredientRow[];
  steps: DisplayableStepRow[];
  tags: string[];
};

export function toDomainRecipe(full: DisplayableRecipe): Recipe {
  /* body moved verbatim from the route, with `full.recipe.*` field access
     unchanged (the route's FullRecipe structurally satisfies DisplayableRecipe) */
}

export function resolveDisplay(
  source: { quantity: Quantity | null; unit: string | null },
  scaledQty: Quantity | null,
  displayUnits: 'metric' | 'imperial',
): { displayQuantity: Quantity | null; displayUnit: string | null } {
  /* body moved verbatim from the route */
}
```

Update the detail route to import these and delete its local copies. `pnpm typecheck && pnpm test:components` must stay green before continuing.

- [x] **Step 2: i18n keys** — add to `src/lib/i18n.en.ts` (and German equivalents in `i18n.de.ts`):

```ts
  share: {
    action: 'Share',
    dialog_title: 'Share this recipe',
    dialog_body:
      'Anyone with the link can view this recipe — no account needed. Turn it off any time; the old link stops working immediately.',
    toggle_label: 'Public link',
    copy_link: 'Copy link',
    link_copied: 'Link copied',
    share_failed: "Couldn't update sharing. Try again.",
    regenerate_hint: 'Turning the link back on creates a new address.',
  },
  public: {
    from_household: "From {{name}}'s pantry",
    cta_title: 'Cook it yourself',
    cta_body: 'Save this recipe into your own pantry and keep every recipe you love in one place.',
    cta_action: 'Start your own pantry',
    inactive_title: 'This link is no longer active',
    inactive_body: 'The cook who shared it may have turned it off. Ask them for a fresh link.',
    inactive_action: 'Explore Dishton',
  },
```

- [x] **Step 3: ShareDialog failing tests** (mock pattern from `RecipeCardDeleteButton.test.tsx`: mock `react-i18next`, `@/lib/queries/shares`, `@/ui/primitives/Toast`):

```tsx
// src/ui/recipe/ShareDialog.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const enableMock = vi.fn();
const disableMock = vi.fn();
const pushMock = vi.fn();
let shareData: { token: string } | null = null;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/lib/queries/shares', () => ({
  useRecipeShare: () => ({ data: shareData, isLoading: false }),
  useEnableShare: () => ({ mutate: enableMock, isPending: false }),
  useDisableShare: () => ({ mutate: disableMock, isPending: false }),
}));
vi.mock('@/ui/primitives/Toast', () => ({ useToast: () => ({ push: pushMock }) }));

import { ShareDialog } from './ShareDialog';

describe('ShareDialog', () => {
  beforeEach(() => {
    enableMock.mockReset();
    disableMock.mockReset();
    pushMock.mockReset();
    shareData = null;
  });

  it('shows the toggle off with no link when unshared', async () => {
    const user = userEvent.setup();
    render(<ShareDialog recipeId="rec_1" />);
    await user.click(screen.getByRole('button', { name: 'share.action' }));
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByRole('button', { name: 'share.copy_link' })).not.toBeInTheDocument();
  });

  it('enables sharing when the switch is turned on', async () => {
    const user = userEvent.setup();
    render(<ShareDialog recipeId="rec_1" />);
    await user.click(screen.getByRole('button', { name: 'share.action' }));
    await user.click(screen.getByRole('switch'));
    expect(enableMock).toHaveBeenCalledTimes(1);
  });

  it('shows the share URL and copies it when shared', async () => {
    shareData = { token: 'cafe0123cafe0123cafe0123cafe0123' };
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const user = userEvent.setup();
    render(<ShareDialog recipeId="rec_1" />);
    await user.click(screen.getByRole('button', { name: 'share.action' }));
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/\/r\/cafe0123cafe0123cafe0123cafe0123/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'share.copy_link' }));
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('/r/cafe0123cafe0123cafe0123cafe0123'),
    );
    expect(pushMock).toHaveBeenCalled();
  });

  it('disables sharing when the switch is turned off', async () => {
    shareData = { token: 'cafe0123cafe0123cafe0123cafe0123' };
    const user = userEvent.setup();
    render(<ShareDialog recipeId="rec_1" />);
    await user.click(screen.getByRole('button', { name: 'share.action' }));
    await user.click(screen.getByRole('switch'));
    expect(disableMock).toHaveBeenCalledTimes(1);
  });
});
```

- [x] **Step 4:** Run `pnpm vitest run src/ui/recipe/ShareDialog.test.tsx` → FAIL. **Step 5: Implement**

```tsx
// src/ui/recipe/ShareDialog.tsx
import { sharePath } from '@/domain';
import { useDisableShare, useEnableShare, useRecipeShare } from '@/lib/queries/shares';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/ui/primitives/Dialog';
import { Switch } from '@/ui/primitives/Switch';
import { useToast } from '@/ui/primitives/Toast';
import { Copy, Share2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type ShareDialogProps = { recipeId: string };

export function ShareDialog({ recipeId }: ShareDialogProps) {
  const { t } = useTranslation();
  const { push } = useToast();
  const shareQ = useRecipeShare(recipeId);
  const enable = useEnableShare(recipeId);
  const disable = useDisableShare(recipeId);

  const token = shareQ.data?.token ?? null;
  const shared = token != null;
  const shareUrl = token ? `${window.location.origin}${sharePath(token)}` : null;
  const busy = shareQ.isLoading || enable.isPending || disable.isPending;

  const onToggle = (next: boolean) => {
    const opts = {
      onError: () => push({ variant: 'error', title: t('share.share_failed') }),
    } as const;
    if (next) enable.mutate(undefined, opts);
    else disable.mutate(undefined, opts);
  };

  const onCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      push({ variant: 'success', title: t('share.link_copied') });
    } catch {
      push({ variant: 'error', title: t('share.share_failed') });
    }
  };

  return (
    <Dialog>
      <DialogTrigger
        className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border border-cream-line bg-paper-2 px-3 text-sm text-ink-soft transition-colors duration-[var(--duration-fast)] hover:bg-paper hover:text-ink"
        aria-label={t('share.action')}
      >
        <Share2 size={14} strokeWidth={1.5} aria-hidden="true" />
        <span>{t('share.action')}</span>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('share.dialog_title')}</DialogTitle>
          <DialogDescription>{t('share.dialog_body')}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-4">
          <span className="font-body text-sm text-ink">{t('share.toggle_label')}</span>
          <Switch
            checked={shared}
            disabled={busy}
            label={t('share.toggle_label')}
            onCheckedChange={onToggle}
          />
        </div>
        {shareUrl && (
          <div className="mt-4 space-y-2">
            <p className="break-all rounded-[var(--radius-md)] border border-cream-line bg-paper px-3 py-2 font-mono text-xs text-ink-soft">
              {shareUrl}
            </p>
            <button
              type="button"
              onClick={() => void onCopy()}
              className="inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] border border-cream-line bg-paper-2 px-3 text-sm text-ink transition-colors hover:bg-paper"
            >
              <Copy size={14} strokeWidth={1.5} aria-hidden="true" />
              {t('share.copy_link')}
            </button>
            <p className="font-body text-xs text-ink-muted">{t('share.regenerate_hint')}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

(Check `useToast`'s `push` signature in `src/ui/primitives/Toast.tsx` and match it exactly.)

- [x] **Step 6: Detail page integration** — in `src/routes/h/$householdId/r/$recipeId/index.tsx`, next to the Edit link (inside the `canEdit && (...)` block, wrapping both in a flex row container):

```tsx
{canEdit && (
  <div className="flex shrink-0 items-center gap-2 sm:mt-2">
    {shareEnabled && <ShareDialog recipeId={recipeId} />}
    <Link /* existing Edit link, drop its sm:mt-2 */ />
  </div>
)}
```

with `const shareEnabled = useFeatureFlag('public_recipe_shares');` near the other hooks.

- [x] **Step 7:** `pnpm vitest run src/ui/recipe/ShareDialog.test.tsx` → PASS; `pnpm test:components` green; `pnpm typecheck && pnpm lint`.
- [x] **Step 8: Commit** `feat(spa): share dialog on the recipe detail page`

---

### Task 9: Public route `/r/$token`

**Files:**
- Create: `src/routes/r/$token.tsx`
- Create: `src/ui/recipe/PublicRecipePage.test.tsx`

- [x] **Step 1: Failing component test** (test the page component exported from the route file):

```tsx
// src/ui/recipe/PublicRecipePage.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PublicRecipePayload } from '@/lib/queries/shares';

const payload: PublicRecipePayload = {
  recipe: {
    title: 'Tomato Tarte Tatin',
    description: 'A savoury upside-down pastry.',
    source_type: 'manual',
    source_url: null,
    source_language: 'en',
    canonical_unit_system: 'metric',
    servings: 4,
    total_time_min: 55,
    hero_image_path: null,
    tags: ['tomato', 'pastry'],
    ingredients: [
      { position: 0, raw_text: '500 g cherry tomatoes', quantity: 500, unit: 'g', ingredient_name: 'cherry tomatoes', notes: null, section: null },
    ],
    steps: [{ position: 0, body: 'Heat oven to 200C.', duration_min: 5 }],
  },
  household_name: 'The Pantry',
};

let rpcData: PublicRecipePayload | null = payload;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string>) =>
      vars && 'name' in vars ? `${key}::${vars.name}` : key,
  }),
}));
vi.mock('@/lib/queries/shares', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/queries/shares')>();
  return {
    ...mod,
    usePublicRecipe: () => ({ data: rpcData, isLoading: false, isError: false }),
    usePublicHeroImage: () => null,
  };
});

import { PublicRecipePage } from '@/routes/r/$token';

const search: { servings?: number; units?: 'metric' | 'imperial' } = {};
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    ...opts,
    useParams: () => ({ token: 'tok123' }),
    useSearch: () => search,
    fullPath: '/r/$token',
  }),
  useNavigate: () => vi.fn(),
  Link: ({ children, ...rest }: { children?: React.ReactNode }) => <a {...rest}>{children}</a>,
}));

describe('PublicRecipePage', () => {
  it('renders title, attribution, ingredients, steps, and the signup CTA', () => {
    rpcData = payload;
    render(<PublicRecipePage />);
    expect(screen.getByRole('heading', { name: 'Tomato Tarte Tatin' })).toBeInTheDocument();
    expect(screen.getByText('public.from_household::The Pantry')).toBeInTheDocument();
    expect(screen.getByText('cherry tomatoes')).toBeInTheDocument();
    expect(screen.getByText('Heat oven to 200C.')).toBeInTheDocument();
    expect(screen.getByText('public.cta_action')).toBeInTheDocument();
    expect(screen.queryByText('recipe.edit_action')).not.toBeInTheDocument();
  });

  it('renders the inactive state for a dead link', () => {
    rpcData = null;
    render(<PublicRecipePage />);
    expect(screen.getByText('public.inactive_title')).toBeInTheDocument();
  });
});
```

(Mocking `createFileRoute` is brittle — if the route-mock approach fights the
router plugin, move the page body into `src/ui/recipe/PublicRecipePage.tsx`
taking `{ token, search, onSearchChange }` props, test that directly, and keep
the route file as a thin wrapper. Prefer that split if the first render fails
on router internals.)

- [x] **Step 2:** Run → FAIL. **Step 3: Implement the route**

```tsx
// src/routes/r/$token.tsx
// Public, unauthenticated share landing page. No auth guard by design: the
// token in the URL is the credential, resolved via the get_public_recipe RPC.

import type { Quantity } from '@/domain';
import { formatDisplayQuantity, formatNumber, scale, scaleToServings } from '@/domain';
import { resolveDisplay, toDomainRecipe } from '@/lib/recipe-display';
import { type PublicRecipePayload, usePublicHeroImage, usePublicRecipe } from '@/lib/queries/shares';
import { Badge } from '@/ui/primitives/Badge';
import { Card } from '@/ui/primitives/Card';
import { Skeleton } from '@/ui/primitives/Skeleton';
import { type DisplayIngredient, IngredientsCard } from '@/ui/recipe/IngredientsCard';
import { ServingsScaler } from '@/ui/recipe/ServingsScaler';
import { UnitToggle } from '@/ui/recipe/UnitToggle';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

const Search = z.object({
  servings: z.coerce.number().int().positive().optional(),
  units: z.enum(['metric', 'imperial']).optional(),
});

export const Route = createFileRoute('/r/$token')({
  validateSearch: Search,
  component: PublicRecipePage,
});

export function PublicRecipePage() {
  const { token } = Route.useParams();
  const search = Route.useSearch();
  const nav = useNavigate({ from: Route.fullPath });
  const { t } = useTranslation();
  const q = usePublicRecipe(token);
  const heroUrl = usePublicHeroImage(q.data?.recipe.hero_image_path ?? null);

  const displayUnits = search.units ?? 'metric';

  useEffect(() => {
    if (q.data) document.title = `${q.data.recipe.title} — Dishton`;
  }, [q.data]);

  const displayed = useMemo(() => {
    if (!q.data) return null;
    const domainRecipe = toDomainRecipe({ ...q.data.recipe, tags: q.data.recipe.tags } /* adapt to DisplayableRecipe shape */);
    const scaled = search.servings ? scaleToServings(domainRecipe, search.servings) : domainRecipe;
    const ingredients: DisplayIngredient[] = q.data.recipe.ingredients.map((ing, i) => {
      const scaledQty = scaled.ingredients[i]?.quantity ?? null;
      const { displayQuantity, displayUnit } = resolveDisplay(ing, scaledQty, displayUnits);
      return { ...ing, id: `${ing.position}`, displayQuantity, displayUnit };
    });
    return { servings: scaled.servings, ingredients, steps: q.data.recipe.steps };
  }, [q.data, search.servings, displayUnits]);

  if (q.isLoading) {
    return (
      <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
        <Skeleton className="h-64" />
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-32" />
      </main>
    );
  }

  if (q.isError || !q.data || !displayed) {
    return (
      <PublicFrame>
        <main className="mx-auto max-w-2xl px-4 py-12">
          <Card className="space-y-3 text-center">
            <h1 className="font-display text-2xl text-ink">{t('public.inactive_title')}</h1>
            <p className="text-ink-soft">{t('public.inactive_body')}</p>
            <div className="pt-2">
              <Link to="/" className="/* saffron button classes, mirror CTA below */">
                {t('public.inactive_action')}
              </Link>
            </div>
          </Card>
        </main>
      </PublicFrame>
    );
  }

  const { recipe } = q.data;
  return (
    <PublicFrame>
      <main className="mx-auto max-w-5xl px-4 py-8">
        {heroUrl && (
          <div className="mb-8 aspect-[3/2] overflow-hidden rounded-[var(--radius-lg)] border border-cream-line">
            <img src={heroUrl} alt="" className="h-full w-full object-cover" />
          </div>
        )}
        <div className="mb-3 flex flex-wrap gap-2">
          {recipe.tags.map((tag) => (
            <Badge key={tag} variant="outline">{tag}</Badge>
          ))}
        </div>
        <h1 className="mb-2 font-display text-display leading-tight">{recipe.title}</h1>
        <p className="mb-4 font-mono text-xs uppercase tracking-[0.18em] text-saffron">
          {t('public.from_household', { name: q.data.household_name })}
        </p>
        {recipe.description && (
          <p className="mb-8 max-w-prose text-lg leading-relaxed text-ink-soft">{recipe.description}</p>
        )}

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[20rem_1fr]">
          <aside className="space-y-6">
            <Card className="space-y-4 p-5">
              <ServingsScaler
                servings={displayed.servings}
                defaultServings={recipe.servings}
                onChange={(s) =>
                  nav({ to: '.', search: (prev) => ({ ...prev, servings: Math.round(s) }), resetScroll: false })
                }
              />
              <UnitToggle
                value={displayUnits}
                onChange={(u) => nav({ to: '.', search: (prev) => ({ ...prev, units: u }), resetScroll: false })}
              />
            </Card>
            <IngredientsCard
              ingredients={displayed.ingredients}
              formatDecimal={formatNumber}
              formatDisplayQuantity={formatDisplayQuantity}
            />
          </aside>
          <section>
            <h2 className="mb-4 font-display text-xl">{t('recipe.steps')}</h2>
            <ol className="space-y-6">
              {displayed.steps.map((s) => (
                <li key={s.position} className="grid grid-cols-[2.5rem_1fr] gap-4">
                  <span className="font-mono text-2xl tabular-nums text-saffron">{s.position + 1}</span>
                  <p className="leading-relaxed">{s.body}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <Card className="mt-12 space-y-3 bg-paper-2 p-6 text-center">
          <h2 className="font-display text-2xl text-ink">{t('public.cta_title')}</h2>
          <p className="mx-auto max-w-prose text-ink-soft">{t('public.cta_body')}</p>
          <div className="pt-1">
            <Link
              to="/auth/signup"
              className="inline-flex h-11 items-center rounded-[var(--radius-md)] bg-saffron px-5 font-body text-sm text-saffron-ink shadow-press transition-colors hover:opacity-90"
            >
              {t('public.cta_action')}
            </Link>
          </div>
        </Card>
      </main>
    </PublicFrame>
  );
}

function PublicFrame({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-cream-line">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link to="/" className="font-display text-xl text-ink">
            {t('app.name')}
          </Link>
          <Link to="/auth/signup" className="font-body text-sm text-ink-soft hover:text-ink">
            {t('public.cta_action')}
          </Link>
        </div>
      </header>
      {children}
    </div>
  );
}
```

`DisplayIngredient` requires an `id: string` — synthesised from `position`. The `toDomainRecipe` call adapts the RPC payload into the `DisplayableRecipe` shape from Task 8 (write the literal object mapping, no casts). The route renders outside `AppShell` — confirm `__root.tsx` only wraps `/h/*` routes with the shell chrome; if the shell is unconditional, mirror however `/auth/login` opts out.

- [x] **Step 4:** routeTree regeneration: run `pnpm build` (the TanStack Router Vite plugin rewrites `src/routeTree.gen.ts`). Then `pnpm vitest run src/ui/recipe/PublicRecipePage.test.tsx` → PASS; `pnpm typecheck && pnpm lint && pnpm test:components`.
- [x] **Step 5: Commit** `feat(spa): public /r/$token recipe landing page`

---

### Task 10: vercel.json bot rewrite + index.html OG defaults + docs + flag table

**Files:**
- Modify: `vercel.json`, `index.html`
- Modify: `docs/00-overview.md`, `docs/04-data-model.md`, `docs/15-roadmap-and-flags.md`

- [x] **Step 1: vercel.json** — insert BEFORE the existing SPA catch-all rewrite:

```json
    {
      "source": "/r/:token",
      "has": [
        {
          "type": "header",
          "key": "user-agent",
          "value": ".*(?i)(bot|facebookexternalhit|whatsapp|slack|telegram|discord|twitter|linkedin|pinterest|skype|embedly|quora|vkshare|crawler|spider|preview).*"
        }
      ],
      "destination": "https://hdfpnxjxrcupuxrgrnpf.supabase.co/functions/v1/public-recipe/:token"
    },
```

(Hardcoding the project ref matches the existing CSP in the same file. If re2 rejects the inline `(?i)` group position, use `(?i).*(bot|...).*`.)

- [x] **Step 2: index.html** — add after the existing description meta:

```html
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Dishton" />
    <meta property="og:title" content="Dishton" />
    <meta property="og:description" content="Your household's recipe pantry." />
    <meta property="og:image" content="/icons/icon-512.png" />
```

(Confirm `public/icons/icon-512.png` exists; otherwise use the largest icon present.)

- [x] **Step 3: docs**
  - `docs/00-overview.md` out-of-scope bullet → `Public/anonymous browsing of collections outside the follow model (opt-in single-recipe share links shipped 2026-06; see docs/superpowers/specs/2026-06-11-public-recipe-share-design.md).`
  - `docs/15-roadmap-and-flags.md`: add flag-table row `| feature_flags.public_recipe_shares | runtime | true | true | true | true | [15](./15-roadmap-and-flags.md) (this doc) | Share links GA for 30 days with no kill-switch use |` and a short paragraph under v1 describing the share-link landing surface (opt-in, revocable, OG unfurl).
  - `docs/04-data-model.md`: add a `recipe_shares` section with the DDL + RLS from Task 2 and a note on the storage policy branch + `get_public_recipe`.

- [x] **Step 4:** `pnpm lint` (Biome also checks JSON). Commit `feat(share): crawler rewrite, site OG defaults, docs`

---

### Task 11: E2E smoke + full verification

**Files:**
- Create: `e2e/public-share.spec.ts`

- [x] **Step 1: E2E spec** (mirror the conventions in `e2e/smoke.spec.ts` — base URL, fixtures):

```ts
import { expect, test } from '@playwright/test';

// Seeded by supabase/seed.sql: Tomato Tarte Tatin shared with a fixed token.
const SHARE_URL = '/r/a1b2c3d4e5f60718293a4b5c6d7e8f90';

test('public share link renders the recipe without auth', async ({ page }) => {
  await page.goto(SHARE_URL);
  await expect(page.getByRole('heading', { name: 'Tomato Tarte Tatin' })).toBeVisible();
  await expect(page.getByText('cherry tomatoes')).toBeVisible();
  await expect(page.getByRole('link', { name: /start your own pantry/i })).toBeVisible();
});

test('an unknown token shows the inactive state', async ({ page }) => {
  await page.goto('/r/deaddeaddeaddeaddeaddeaddeaddead');
  await expect(page.getByText(/no longer active/i)).toBeVisible();
});
```

- [x] **Step 2: Full local verification** —
  - `pnpm typecheck && pnpm lint`
  - `pnpm test:unit && pnpm test:components`
  - `pnpm test:db` (stack running)
  - `pnpm test:edge`
  - `pnpm build`
- [x] **Step 3: Commit** `test(e2e): public share landing smoke`

---

### Task 12: Visual validation (REQUIRED)

- [x] **Step 1:** Invoke the `validating-features-visually` skill and follow it exactly (Docker daemon, Supabase CLI tarball, `supabase start -x edge-runtime,functions`, `pnpm db:reset`, `pnpm build && pnpm preview`).
- [x] **Step 2:** Drive Playwright through, at desktop (1280×800) and mobile (390×844):
  1. Logged-out visit to `/r/a1b2c3d4e5f60718293a4b5c6d7e8f90` — hero/title/tags/ingredients/steps/CTA, servings scaling, unit toggle.
  2. Unknown token `/r/deaddead...` inactive state.
  3. Login as alice → recipe detail → Share button → dialog on/off/copy states.
  4. Adjacent surface: the recipe detail page itself (regression from the header/button change).
- [x] **Step 3:** Screenshot each step, review for overflow/flash/contrast issues, fix anything found, re-run.
- [x] **Step 4:** Final `pnpm typecheck && pnpm lint`, commit fixes, push branch.

---

## Self-review notes

- Spec §4 storage branch, §5 both endpoints, §6 helpers, §7 all SPA pieces, §8 XSS/kill-switch/cache, §9 docs, §10 every test layer → covered by Tasks 1–12.
- Edge `index.ts` is deliberately not unit-tested (serve() at module top, wasm renderer); its pure inputs (`meta.ts`, `og.ts`, `share.ts`, RPC) are.
- Existing DB inventory tests (`production_readiness`, `security_hardening`) may assert on policy/grant lists — update them alongside Task 2 if they fail.
