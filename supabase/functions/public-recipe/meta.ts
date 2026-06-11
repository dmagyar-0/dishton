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
