// public-recipe: unauthenticated GET surface for the share loop.
//   GET /public-recipe/<token>          -> OG meta HTML (crawlers; humans get
//                                          a meta-refresh to /r/<token>)
//   GET /public-recipe/<token>/og.png   -> 1200x630 OG card PNG (Satori)
// verify_jwt is off (supabase/config.toml): the token in the path is the
// credential; reads go through the same get_public_recipe RPC as the SPA.
//
// Env is read directly (not via _shared/env.ts) so this function doesn't
// fail cold start on ANTHROPIC_API_KEY, which it never uses.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { shareSummary, type ShareRecipe } from '../_shared/domain/share.ts';
import { buildRecipePage } from './meta.ts';
import { buildOgElement } from './og.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
// Canonical app origin for og:url / redirects. Override in prod via
// `supabase secrets set PUBLIC_APP_ORIGIN=https://<app-domain>`.
const APP_ORIGIN = Deno.env.get('PUBLIC_APP_ORIGIN') ?? 'https://dishton.vercel.app';

const CACHE_OK = 'public, max-age=300, s-maxage=3600';

type PublicRecipePayload = {
  recipe: ShareRecipe & { hero_image_path: string | null };
  household_name: string;
};

function makeAdminClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    db: { schema: 'app' },
  });
}
let _admin: ReturnType<typeof makeAdminClient> | null = null;
function adminClient() {
  if (_admin === null) _admin = makeAdminClient();
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

function factsLine(payload: PublicRecipePayload): string {
  // The card and OG description always show the facts line; prose
  // descriptions belong to the meta description only.
  return shareSummary({
    description: null,
    servings: payload.recipe.servings,
    total_time_min: payload.recipe.total_time_min,
    ingredientCount: payload.recipe.ingredients.length,
  });
}

async function handleOgImage(payload: PublicRecipePayload): Promise<Response> {
  // Dynamic import keeps the (wasm-heavy) renderer off the meta path.
  const { ImageResponse } = await import('https://deno.land/x/og_edge@0.0.6/mod.ts');
  const hero = await heroDataUri(payload.recipe.hero_image_path);
  const font = await loadFont();
  const element = buildOgElement({
    title: payload.recipe.title,
    householdName: payload.household_name,
    metaLine: factsLine(payload),
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
  const description = shareSummary({
    description: payload.recipe.description,
    servings: payload.recipe.servings,
    total_time_min: payload.recipe.total_time_min,
    ingredientCount: payload.recipe.ingredients.length,
  });
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
  if (!token || !/^[0-9a-f]{16,64}$/.test(token) || (tail !== undefined && tail !== 'og.png')) {
    return notFound();
  }

  try {
    const payload = await loadPayload(token);
    if (!payload) return notFound();
    return tail === 'og.png' ? await handleOgImage(payload) : handleMeta(token, payload);
  } catch (e) {
    console.error('public-recipe error', (e as Error).message);
    return new Response(JSON.stringify({ error: 'internal' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
});
