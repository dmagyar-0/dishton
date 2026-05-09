// Tests for the no-key Instagram fallback chain. The fallback is exercised via
// installMockFetch so we can assert which endpoints are tried and in what order.

import { assert, assertEquals } from 'jsr:@std/assert';
import { installMockFetch } from '../_shared/mock_fetch.ts';
import {
  captionedEmbedUrl,
  fetchOgFallback,
  mirrorUrl,
  parseInstagramHtml,
} from './fallback.ts';

const REEL_URL = 'https://www.instagram.com/reel/DX6MMYWOn3Z/?igsh=abcd';
const POST_URL = 'https://www.instagram.com/p/ABC123/';

function htmlWithOg(parts: { title?: string; description?: string; image?: string }): string {
  const tags: string[] = [];
  if (parts.title) tags.push(`<meta property="og:title" content="${parts.title}" />`);
  if (parts.description) {
    tags.push(`<meta property="og:description" content="${parts.description}" />`);
  }
  if (parts.image) tags.push(`<meta property="og:image" content="${parts.image}" />`);
  return `<!doctype html><html><head>${tags.join('')}</head><body></body></html>`;
}

function htmlResponse(html: string, init: ResponseInit = {}): Response {
  return new Response(html, {
    ...init,
    headers: { 'content-type': 'text/html', ...(init.headers ?? {}) },
  });
}

Deno.test('captionedEmbedUrl: rewrites /reel/<id>/ to /reel/<id>/embed/captioned/', () => {
  assertEquals(
    captionedEmbedUrl(REEL_URL),
    'https://www.instagram.com/reel/DX6MMYWOn3Z/embed/captioned/',
  );
});

Deno.test('captionedEmbedUrl: rewrites /p/<id>/ post URLs', () => {
  assertEquals(
    captionedEmbedUrl(POST_URL),
    'https://www.instagram.com/p/ABC123/embed/captioned/',
  );
});

Deno.test('captionedEmbedUrl: normalises /reels/<id>/ to /reel/<id>/', () => {
  assertEquals(
    captionedEmbedUrl('https://www.instagram.com/reels/XYZ789/'),
    'https://www.instagram.com/reel/XYZ789/embed/captioned/',
  );
});

Deno.test('captionedEmbedUrl: returns null for non-Instagram hosts', () => {
  assertEquals(captionedEmbedUrl('https://example.com/reel/abc/'), null);
});

Deno.test('captionedEmbedUrl: returns null for unsupported paths (e.g. /stories/)', () => {
  assertEquals(captionedEmbedUrl('https://www.instagram.com/stories/foo/123/'), null);
});

Deno.test('mirrorUrl: maps instagram.com path onto ddinstagram.com', () => {
  assertEquals(
    mirrorUrl(REEL_URL),
    'https://www.ddinstagram.com/reel/DX6MMYWOn3Z/',
  );
});

Deno.test('mirrorUrl: returns null for non-Instagram hosts', () => {
  assertEquals(mirrorUrl('https://tiktok.com/@x/video/1'), null);
});

Deno.test('parseInstagramHtml: extracts og:title, og:description and og:image', () => {
  const oe = parseInstagramHtml(
    htmlWithOg({
      title: '@chef on Instagram',
      description: '500g tomatoes, 4 servings',
      image: 'https://example.test/cover.jpg',
    }),
  );
  assert(oe);
  assertEquals(oe.title, '@chef on Instagram');
  assertEquals(oe.html, '500g tomatoes, 4 servings');
  assertEquals(oe.thumbnail_url, 'https://example.test/cover.jpg');
});

Deno.test('parseInstagramHtml: returns null when both title and description are missing', () => {
  const oe = parseInstagramHtml('<html><head></head><body>no og</body></html>');
  assertEquals(oe, null);
});

Deno.test('parseInstagramHtml: tolerates content-before-property attribute order', () => {
  const html =
    '<meta content="A caption" property="og:description"><meta content="A title" property="og:title">';
  const oe = parseInstagramHtml(html);
  assert(oe);
  assertEquals(oe.title, 'A title');
  assertEquals(oe.html, 'A caption');
});

Deno.test('fetchOgFallback: succeeds via /embed/captioned/ when it returns 200', async () => {
  using mock = installMockFetch([
    {
      match: (req) => req.url.endsWith('/reel/DX6MMYWOn3Z/embed/captioned/'),
      response: htmlResponse(
        htmlWithOg({
          title: '@chef on Instagram',
          description: 'Tomato tarte recipe',
          image: 'https://example.test/cover.jpg',
        }),
      ),
    },
  ]);
  const oe = await fetchOgFallback(REEL_URL);
  assert(oe);
  assertEquals(oe.html, 'Tomato tarte recipe');
  assertEquals(mock.calls.length, 1);
  assert(mock.calls[0].url.includes('/embed/captioned/'));
  // Sanity: the fetch must use a realistic browser UA, not DishtonBot. Instagram
  // returns 401/403 to non-browser UAs from datacenter IPs in production.
  const ua = mock.calls[0].headers.get('user-agent') ?? '';
  assert(/Mozilla/.test(ua), `expected browser UA, got: ${ua}`);
});

Deno.test('fetchOgFallback: falls through embed → direct → mirror when each fails', async () => {
  using mock = installMockFetch([
    {
      match: (req) => req.url.includes('/embed/captioned/'),
      response: new Response('forbidden', { status: 403 }),
    },
    {
      match: (req) => req.url.startsWith('https://www.instagram.com/reel/DX6MMYWOn3Z/?'),
      response: new Response('forbidden', { status: 403 }),
    },
    {
      match: (req) => req.url.startsWith('https://www.ddinstagram.com/'),
      response: htmlResponse(
        htmlWithOg({ title: 'mirror title', description: 'mirror caption' }),
      ),
    },
  ]);
  const oe = await fetchOgFallback(REEL_URL);
  assert(oe);
  assertEquals(oe.html, 'mirror caption');
  assertEquals(mock.calls.length, 3);
  assert(mock.calls[0].url.includes('/embed/captioned/'));
  assert(mock.calls[1].url.startsWith('https://www.instagram.com/reel/DX6MMYWOn3Z/?'));
  assert(mock.calls[2].url.startsWith('https://www.ddinstagram.com/'));
});

Deno.test('fetchOgFallback: returns null when all tiers fail', async () => {
  using _mock = installMockFetch([
    {
      match: () => true,
      response: new Response('forbidden', { status: 403 }),
    },
  ]);
  const oe = await fetchOgFallback(REEL_URL);
  assertEquals(oe, null);
});

Deno.test('fetchOgFallback: returns null when responses are 200 but contain no og tags (login wall)', async () => {
  using _mock = installMockFetch([
    {
      match: () => true,
      response: htmlResponse('<html><body>login required</body></html>'),
    },
  ]);
  const oe = await fetchOgFallback(REEL_URL);
  assertEquals(oe, null);
});
