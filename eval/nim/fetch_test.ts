import { assertEquals } from '@std/assert';
import { extractFromHtml } from './fetch.ts';

const SAMPLE_ARTICLE_HTML = `
<!DOCTYPE html>
<html><head><title>Test Recipe</title></head>
<body>
  <article>
    <h1>Chocolate Cake</h1>
    <p>This is the most important paragraph of the article. It contains
    enough text for Readability to consider it the main content of the page,
    not navigation chrome. We need at least a few hundred characters here so
    Readability does not bail out on a sparse page. The cake is delicious.
    Mix flour, sugar, cocoa, eggs, and milk. Bake for 30 minutes at 180C.
    Serves 8 people.</p>
    <p>Cool before serving. The cake stores well in an airtight container
    for up to three days at room temperature.</p>
  </article>
</body></html>
`;

const EMPTY_HTML = `<!DOCTYPE html><html><body></body></html>`;

Deno.test('fetch: extractFromHtml returns Readability text on a normal page', () => {
  const r = extractFromHtml(SAMPLE_ARTICLE_HTML, SAMPLE_ARTICLE_HTML.length);
  assertEquals(r.readabilityUsed, true);
  assertEquals(r.text.includes('Chocolate Cake'), true);
  assertEquals(r.text.includes('Bake for 30 minutes'), true);
  assertEquals(r.bytes, SAMPLE_ARTICLE_HTML.length);
});

Deno.test('fetch: extractFromHtml falls back to raw HTML when Readability is empty', () => {
  const r = extractFromHtml(EMPTY_HTML, EMPTY_HTML.length);
  assertEquals(r.readabilityUsed, false);
  assertEquals(r.text, EMPTY_HTML);
});
