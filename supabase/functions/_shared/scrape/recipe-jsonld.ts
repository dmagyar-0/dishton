// Code-based pre-step for recipe URL imports: walks <script type="application/ld+json">
// tags looking for a schema.org/Recipe node, normalizes it to a flat shape, and
// returns null on any failure. Caller (import-url) feeds the result to Claude as
// the primary source of truth via structuringFromHtml({ scraped }).
//
// Covers JSON-LD only — most major recipe sites (NYT, AllRecipes, Bon Appétit,
// Serious Eats, BBC Good Food, Smitten Kitchen, Yoast-using WordPress) embed
// Recipe data this way. Microdata (`itemtype="https://schema.org/Recipe"`) is
// a future addition; check production `scrape.jsonld` log coverage before
// adding it.

export type ScrapedRecipe = {
  name: string | null;
  description: string | null;
  image: string | null;
  author: string | null;
  yield: string | null;
  prep_time_min: number | null;
  cook_time_min: number | null;
  total_time_min: number | null;
  ingredients: string[];
  instructions: string[];
  keywords: string[];
  language: string | null;
};

// Structural type for what we need from a parsed DOM. Matches both the
// standard DOM Document and linkedom's document — Deno doesn't expose `lib.dom`
// by default in Edge Functions, so we type only what we use.
export interface ScrapeDoc {
  querySelectorAll(selector: string): ArrayLike<{ textContent: string | null }>;
}

type Json = Record<string, unknown>;

export function extractRecipeJsonLd(doc: ScrapeDoc): ScrapedRecipe | null {
  try {
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (let i = 0; i < scripts.length; i++) {
      const s = scripts[i];
      const raw = s.textContent;
      if (!raw) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      const recipe = findRecipe(parsed);
      if (recipe) return normalize(recipe);
    }
    return null;
  } catch {
    return null;
  }
}

function findRecipe(node: unknown): Json | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const r = findRecipe(item);
      if (r) return r;
    }
    return null;
  }
  const obj = node as Json;
  const t = obj['@type'];
  if (t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'))) return obj;
  if (Array.isArray(obj['@graph'])) return findRecipe(obj['@graph']);
  return null;
}

function normalize(r: Json): ScrapedRecipe {
  return {
    name: str(r.name),
    description: str(r.description),
    image: firstImage(r.image),
    author: authorName(r.author),
    yield: yieldString(r.recipeYield),
    prep_time_min: isoToMinutes(r.prepTime),
    cook_time_min: isoToMinutes(r.cookTime),
    total_time_min: isoToMinutes(r.totalTime),
    ingredients: stringArray(r.recipeIngredient),
    instructions: flattenInstructions(r.recipeInstructions),
    keywords: keywords(r),
    language: str(r.inLanguage),
  };
}

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === 'string') {
      const t = item.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

function firstImage(v: unknown): string | null {
  if (typeof v === 'string') return str(v);
  if (Array.isArray(v) && v.length > 0) return firstImage(v[0]);
  if (v && typeof v === 'object') {
    const o = v as Json;
    if (typeof o.url === 'string') return str(o.url);
  }
  return null;
}

function authorName(v: unknown): string | null {
  if (typeof v === 'string') return str(v);
  if (Array.isArray(v) && v.length > 0) return authorName(v[0]);
  if (v && typeof v === 'object') {
    const o = v as Json;
    if (typeof o.name === 'string') return str(o.name);
  }
  return null;
}

function yieldString(v: unknown): string | null {
  if (typeof v === 'string') return str(v);
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (Array.isArray(v) && v.length > 0) return yieldString(v[0]);
  return null;
}

const ISO_DURATION = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

function isoToMinutes(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = ISO_DURATION.exec(v.trim());
  if (!m) return null;
  const [, d, h, mi, sec] = m;
  const total = (+(d ?? 0)) * 1440 + (+(h ?? 0)) * 60 + (+(mi ?? 0)) +
    Math.round((+(sec ?? 0)) / 60);
  return total > 0 ? total : null;
}

function flattenInstructions(v: unknown): string[] {
  if (typeof v === 'string') {
    const t = v.trim();
    return t ? [t] : [];
  }
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === 'string') {
      const t = item.trim();
      if (t) out.push(t);
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const o = item as Json;
    if (o['@type'] === 'HowToSection' && Array.isArray(o.itemListElement)) {
      out.push(...flattenInstructions(o.itemListElement));
      continue;
    }
    if (typeof o.text === 'string') {
      const t = o.text.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

function keywords(r: Json): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    const t = s.trim();
    if (!t) return;
    const k = t.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(t);
  };
  for (const key of ['recipeKeywords', 'keywords', 'recipeCategory', 'recipeCuisine']) {
    const v = r[key];
    if (typeof v === 'string') {
      for (const part of v.split(',')) push(part);
    } else if (Array.isArray(v)) {
      for (const item of v) if (typeof item === 'string') push(item);
    }
  }
  return out;
}
