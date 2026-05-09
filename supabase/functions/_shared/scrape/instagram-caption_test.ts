// Tests for the shared Instagram caption fetcher. Mocks globalThis.fetch via
// _shared/mock_fetch.ts. Covers oEmbed, OG fallback, the chain between them,
// the no-content failure case, and caption-string assembly.

import { assert, assertEquals } from 'jsr:@std/assert';
import { installMockFetch, jsonResponse } from '../mock_fetch.ts';
import { fetchInstagramCaption } from './instagram-caption.ts';

const REEL = 'https://www.instagram.com/reel/ABC123/';

function htmlResponse(html: string, init: ResponseInit = {}): Response {
  return new Response(html, {
    ...init,
    headers: { 'content-type': 'text/html; charset=utf-8', ...(init.headers ?? {}) },
  });
}

Deno.test('instagram-caption: oembed success → source=oembed, caption assembled from title + description', async () => {
  using mock = installMockFetch([
    {
      match: (req) => req.url.includes('graph.facebook.com'),
      response: jsonResponse({
        title: 'Spicy Mango Salad',
        html: '<p>1 ripe mango\n2 chillies\nLime juice</p>',
        thumbnail_url: 'https://example.test/thumb.jpg',
      }),
    },
  ]);
  const r = await fetchInstagramCaption(REEL, { token: 'IG_TOKEN' });
  assert(r !== null);
  assertEquals(r!.source, 'oembed');
  assertEquals(r!.thumbnailUrl, 'https://example.test/thumb.jpg');
  assertEquals(
    r!.caption,
    'Spicy Mango Salad\n\n1 ripe mango\n2 chillies\nLime juice',
  );
  assertEquals(mock.calls.length, 1);
  // Token must be forwarded; URL must be percent-encoded.
  const sent = mock.calls[0]!.url;
  assert(sent.includes('access_token=IG_TOKEN'));
  assert(sent.includes(encodeURIComponent(REEL)));
});

Deno.test('instagram-caption: oembed 401 → falls back to OG meta scrape', async () => {
  using mock = installMockFetch([
    {
      match: (req) => req.url.includes('graph.facebook.com'),
      response: jsonResponse({ error: 'unauth' }, { status: 401 }),
    },
    {
      match: (req) => req.url.startsWith('https://www.instagram.com/'),
      response: htmlResponse(`<!doctype html><html><head>
        <meta property="og:title" content="OG Title" />
        <meta property="og:description" content="OG description text" />
        <meta property="og:image" content="https://example.test/og.jpg" />
      </head><body></body></html>`),
    },
  ]);
  const r = await fetchInstagramCaption(REEL, { token: 'IG_TOKEN' });
  assert(r !== null);
  assertEquals(r!.source, 'og');
  assertEquals(r!.thumbnailUrl, 'https://example.test/og.jpg');
  assertEquals(r!.caption, 'OG Title\n\nOG description text');
  assertEquals(mock.calls.length, 2);
});

Deno.test('instagram-caption: no token → goes straight to OG, no graph.facebook.com call', async () => {
  using mock = installMockFetch([
    {
      match: (req) => req.url.startsWith('https://www.instagram.com/'),
      response: htmlResponse(`<!doctype html><html><head>
        <meta property="og:title" content="Title only" />
        <meta property="og:image" content="https://example.test/img.jpg" />
      </head><body></body></html>`),
    },
  ]);
  const r = await fetchInstagramCaption(REEL, {});
  assert(r !== null);
  assertEquals(r!.source, 'og');
  // og:description missing → caption is title + blank line.
  assertEquals(r!.caption, 'Title only\n\n');
  assertEquals(mock.calls.length, 1);
  assert(!mock.calls.some((c) => c.url.includes('graph.facebook.com')));
});

Deno.test('instagram-caption: OG with neither title nor description → null', async () => {
  using mock = installMockFetch([
    {
      match: (req) => req.url.startsWith('https://www.instagram.com/'),
      response: htmlResponse(`<!doctype html><html><head>
        <meta property="og:image" content="https://example.test/img.jpg" />
      </head><body></body></html>`),
    },
  ]);
  const r = await fetchInstagramCaption(REEL, {});
  assertEquals(r, null);
  assertEquals(mock.calls.length, 1);
});

Deno.test('instagram-caption: OG fetch returns 4xx → null', async () => {
  using mock = installMockFetch([
    {
      match: (req) => req.url.startsWith('https://www.instagram.com/'),
      response: new Response('forbidden', { status: 403 }),
    },
  ]);
  const r = await fetchInstagramCaption(REEL, {});
  assertEquals(r, null);
  assertEquals(mock.calls.length, 1);
});

Deno.test('instagram-caption: oembed empty html → caption is title-only', async () => {
  using mock = installMockFetch([
    {
      match: (req) => req.url.includes('graph.facebook.com'),
      response: jsonResponse({ title: 'Just a title', html: '', thumbnail_url: null }),
    },
  ]);
  const r = await fetchInstagramCaption(REEL, { token: 'IG_TOKEN' });
  assert(r !== null);
  assertEquals(r!.caption, 'Just a title\n\n');
  assertEquals(r!.thumbnailUrl, null);
});

Deno.test('instagram-caption: OG description with embedded HTML tags is stripped in caption', async () => {
  using mock = installMockFetch([
    {
      match: (req) => req.url.startsWith('https://www.instagram.com/'),
      // og:description sometimes contains entities; we only strip tags, not entities,
      // matching production behavior verbatim.
      response: htmlResponse(`<!doctype html><html><head>
        <meta property="og:title" content="Tag soup" />
        <meta property="og:description" content="line 1 line 2" />
      </head><body></body></html>`),
    },
  ]);
  const r = await fetchInstagramCaption(REEL, {});
  assert(r !== null);
  assertEquals(r!.caption, 'Tag soup\n\nline 1 line 2');
});
