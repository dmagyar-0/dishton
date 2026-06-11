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
  assert(
    html.includes(
      'property="og:image" content="https://fns.example/public-recipe/tok123/og.png"',
    ),
  );
  assert(html.includes('property="og:url" content="https://app.example/r/tok123"'));
  assert(html.includes('name="twitter:card" content="summary_large_image"'));
  assert(html.includes('name="robots" content="noindex"'));
  assert(html.includes('http-equiv="refresh"'));
  assert(html.includes('rel="canonical" href="https://app.example/r/tok123"'));
});
