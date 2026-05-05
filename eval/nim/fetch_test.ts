import { assertEquals, assertStringIncludes } from '@std/assert';
import { extractFromHtml } from './fetch.ts';

const SAMPLE_HTML = `
<!DOCTYPE html>
<html><head><title>Test Recipe</title><script>var x = 1;</script></head>
<body>
  <article>
    <h1>Chocolate Cake</h1>
    <p>Mix flour, sugar, cocoa, eggs, milk. Bake 30 min at 180C.</p>
  </article>
</body></html>
`;

const HTML_WITH_RECIPE_JSONLD = `
<!DOCTYPE html><html><head>
<script type="application/ld+json">${
  JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: 'Quick Pasta',
    recipeIngredient: ['200 g pasta'],
    recipeInstructions: ['Boil water.'],
  })
}</script>
</head><body><article><h1>Quick Pasta</h1><p>Boil water.</p></article></body></html>
`;

Deno.test('fetch: extractFromHtml strips noise tags', () => {
  const r = extractFromHtml(SAMPLE_HTML, SAMPLE_HTML.length);
  assertStringIncludes(r.text, 'Chocolate Cake');
  assertStringIncludes(r.text, 'Bake 30 min');
  assertEquals(r.text.includes('var x'), false);
  assertEquals(r.text.includes('<script'), false);
  assertEquals(r.text.includes('<title'), false);
  assertEquals(r.bytes, SAMPLE_HTML.length);
  assertEquals(r.scraped, null);
});

Deno.test('fetch: extractFromHtml extracts JSON-LD before stripping', () => {
  const r = extractFromHtml(HTML_WITH_RECIPE_JSONLD, HTML_WITH_RECIPE_JSONLD.length);
  // JSON-LD content must survive even though <script> blocks are stripped from text.
  assertEquals(r.scraped?.name, 'Quick Pasta');
  assertEquals(r.scraped?.ingredients, ['200 g pasta']);
  // Stripped HTML still has the article body but not the script tag.
  assertStringIncludes(r.text, 'Quick Pasta');
  assertEquals(r.text.includes('application/ld+json'), false);
});
