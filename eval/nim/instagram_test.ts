// Tests for the Instagram path in the eval harness. Mocks globalThis.fetch
// via _shared/mock_fetch.ts so no real network is touched.

import { assert, assertEquals, assertRejects } from '@std/assert';
import { installMockFetch, jsonResponse } from '../../supabase/functions/_shared/mock_fetch.ts';
import { FetchError, fetchInstagramForEval } from './fetch.ts';

const REEL = 'https://www.instagram.com/reel/DX6MMYWOn3Z/?igsh=abc';

Deno.test('fetchInstagramForEval: og fallback success returns caption + thumbnail', async () => {
  using mock = installMockFetch([
    {
      match: (req) => req.url.startsWith('https://www.instagram.com/'),
      response: new Response(
        `<!doctype html><html><head>
          <meta property="og:title" content="Mango Sticky Rice" />
          <meta property="og:description" content="1 mango • 200g rice • coconut milk" />
          <meta property="og:image" content="https://example.test/thumb.jpg" />
        </head><body></body></html>`,
        { headers: { 'content-type': 'text/html' } },
      ),
    },
  ]);
  // Deliberately no IG_OEMBED_TOKEN → goes straight to OG.
  Deno.env.delete('IG_OEMBED_TOKEN');
  const r = await fetchInstagramForEval(REEL);
  assertEquals(r.source, 'og');
  assertEquals(r.thumbnailUrl, 'https://example.test/thumb.jpg');
  assertEquals(r.caption, 'Mango Sticky Rice\n\n1 mango • 200g rice • coconut milk');
  assertEquals(mock.calls.length, 1);
});

Deno.test('fetchInstagramForEval: oembed token wins over og fallback', async () => {
  using mock = installMockFetch([
    {
      match: (req) => req.url.includes('graph.facebook.com'),
      response: jsonResponse({
        title: 'From oEmbed',
        html: 'caption body',
        thumbnail_url: 'https://example.test/oe.jpg',
      }),
    },
  ]);
  Deno.env.set('IG_OEMBED_TOKEN', 'TEST_TOKEN');
  try {
    const r = await fetchInstagramForEval(REEL);
    assertEquals(r.source, 'oembed');
    assertEquals(r.caption, 'From oEmbed\n\ncaption body');
    assertEquals(r.thumbnailUrl, 'https://example.test/oe.jpg');
    assertEquals(mock.calls.length, 1);
    assert(mock.calls[0]!.url.includes('graph.facebook.com'));
  } finally {
    Deno.env.delete('IG_OEMBED_TOKEN');
  }
});

Deno.test('fetchInstagramForEval: null result throws FetchError(instagram_unavailable)', async () => {
  using _mock = installMockFetch([
    {
      match: (req) => req.url.startsWith('https://www.instagram.com/'),
      response: new Response('forbidden', { status: 403 }),
    },
  ]);
  Deno.env.delete('IG_OEMBED_TOKEN');
  const err = await assertRejects(() => fetchInstagramForEval(REEL), FetchError);
  assertEquals((err as FetchError).reason, 'instagram_unavailable');
});

Deno.test('fetchInstagramForEval: aborted signal surfaces as FetchError(timeout)', async () => {
  // The mock never matches; we abort before fetch is called and assert
  // the wrapper translates the AbortError to a timeout FetchError.
  using _mock = installMockFetch([
    {
      match: () => true,
      response: () =>
        new Promise<Response>((_resolve, reject) => {
          // Simulate a fetch that rejects with AbortError when caller aborts.
          queueMicrotask(() =>
            reject(new DOMException('aborted', 'AbortError'))
          );
        }) as unknown as Response,
    },
  ]);
  Deno.env.delete('IG_OEMBED_TOKEN');
  const ac = new AbortController();
  ac.abort();
  const err = await assertRejects(() => fetchInstagramForEval(REEL, ac.signal), FetchError);
  assertEquals((err as FetchError).reason, 'timeout');
});
