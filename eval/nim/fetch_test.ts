import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert';
import { extractFromHtml, FetchError, fetchAndExtract } from './fetch.ts';

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

// Regression test for streaming-body hang: a server that sends headers
// immediately but never closes the response body must be cut by the timeout.
// Before the fix, the manual setTimeout+AbortController pattern did not wake
// a blocked reader.read() native I/O wait, so the eval hung indefinitely.
Deno.test('fetch: times out when server streams headers but never closes body', async () => {
  // Spin up a minimal HTTP server that sends a valid 200 text/html response
  // but never writes the body or closes the connection.
  const listener = Deno.listen({ port: 0 });
  const { port } = (listener.addr as Deno.NetAddr);

  // Accept one connection, send headers, then stall.
  const serverDone = (async () => {
    const conn = await listener.accept();
    listener.close();
    const buf = new Uint8Array(4096);
    await conn.read(buf); // drain the request
    const headers =
      'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nTransfer-Encoding: chunked\r\n\r\n';
    await conn.write(new TextEncoder().encode(headers));
    // Never send a body chunk or terminal '0\r\n\r\n' — simulates streaming hang.
    // Hold the connection open until the fetch side gives up.
    await new Promise<void>((resolve) => {
      conn.read(new Uint8Array(1)).finally(resolve);
    });
    conn.close();
  })();

  const err = await assertRejects(
    () => fetchAndExtract(`http://localhost:${port}`),
    FetchError,
  );
  assertEquals((err as FetchError).reason, 'timeout');

  await serverDone;
}, { sanitizeResources: false, sanitizeOps: false });
