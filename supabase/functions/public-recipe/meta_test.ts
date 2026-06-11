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

Deno.test('buildRecipePage omits optional blocks when their data is absent', () => {
  const html = page({ description: null, tags: [], source_url: null });
  // core content still renders
  assertStringIncludes(html, '<h1>Rakott Krumpli</h1>');
  assertStringIncludes(html, '<li>800g waxy potatoes</li>');
  assertStringIncludes(html, '<li>Boil the potatoes.</li>');
  // optional blocks are absent
  assert(!html.includes('Hungarian layered potato casserole'));
  assert(!html.includes('class="tags"'));
  assert(!html.includes('Source:'));
});

Deno.test('buildRecipePage drops a non-http(s) source_url (no javascript: href)', () => {
  const danger = page({ source_url: 'javascript:alert(document.cookie)' });
  assert(!danger.includes('javascript:'));
  assert(!danger.includes('Source:'));
  // a normal http(s) url still renders as a link
  const ok = page({ source_url: 'https://example.com/recipe' });
  assertStringIncludes(ok, '<a href="https://example.com/recipe">');
});
