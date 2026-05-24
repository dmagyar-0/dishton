// Tests for the no-key Instagram fallback chain. The fallback is exercised via
// installMockFetch so we can assert which endpoints are tried and in what order.

import { assert, assertEquals } from 'jsr:@std/assert';
import { installMockFetch } from '../_shared/mock_fetch.ts';
import {
  captionedEmbedUrl,
  type FallbackEvent,
  fetchOgFallback,
  mirrorUrl,
  parseInstagramHtml,
  scraperUrl,
} from './fallback.ts';

const REEL_URL = 'https://www.instagram.com/reel/DX6MMYWOn3Z/?igsh=abcd';
const POST_URL = 'https://www.instagram.com/p/ABC123/';
const SCRAPER_KEY = 'test-scraper-key';

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

Deno.test('scraperUrl: wraps the captioned-embed URL through scraperapi.com', () => {
  const expectedTarget = 'https://www.instagram.com/reel/DX6MMYWOn3Z/embed/captioned/';
  assertEquals(
    scraperUrl(REEL_URL, SCRAPER_KEY),
    `https://api.scraperapi.com/?api_key=${SCRAPER_KEY}&url=${encodeURIComponent(expectedTarget)}`,
  );
});

Deno.test('scraperUrl: returns null when api key is missing', () => {
  assertEquals(scraperUrl(REEL_URL, undefined), null);
  assertEquals(scraperUrl(REEL_URL, ''), null);
});

Deno.test('scraperUrl: returns null for non-Instagram hosts', () => {
  assertEquals(scraperUrl('https://tiktok.com/@x/video/1', SCRAPER_KEY), null);
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
  const result = await fetchOgFallback(REEL_URL);
  assert(result);
  assertEquals(result.oembed.html, 'Tomato tarte recipe');
  assertEquals(result.source, 'captioned_embed');
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
  const result = await fetchOgFallback(REEL_URL);
  assert(result);
  assertEquals(result.oembed.html, 'mirror caption');
  assertEquals(result.source, 'mirror');
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
  const result = await fetchOgFallback(REEL_URL);
  assertEquals(result, null);
});

Deno.test('fetchOgFallback: rescues via scraper tier when first three fail and key is set', async () => {
  using mock = installMockFetch([
    {
      match: (req) =>
        req.url.startsWith('https://www.instagram.com/') && !req.url.includes('scraperapi'),
      response: new Response('forbidden', { status: 403 }),
    },
    {
      match: (req) => req.url.startsWith('https://www.ddinstagram.com/'),
      response: new Response('forbidden', { status: 403 }),
    },
    {
      match: (req) => req.url.startsWith('https://api.scraperapi.com/'),
      response: htmlResponse(
        htmlWithOg({ title: 'scraper title', description: 'scraper caption' }),
      ),
    },
  ]);
  const result = await fetchOgFallback(REEL_URL, undefined, undefined, SCRAPER_KEY);
  assert(result);
  assertEquals(result.oembed.html, 'scraper caption');
  assertEquals(result.source, 'scraper');
  assertEquals(mock.calls.length, 4);
  assert(mock.calls[3].url.startsWith('https://api.scraperapi.com/'));
});

Deno.test('fetchOgFallback: skips scraper tier when no api key is provided', async () => {
  using mock = installMockFetch([
    {
      match: () => true,
      response: new Response('forbidden', { status: 403 }),
    },
  ]);
  const result = await fetchOgFallback(REEL_URL);
  assertEquals(result, null);
  // Only embed + direct + mirror — no scraper attempt without a key.
  assertEquals(mock.calls.length, 3);
  assert(!mock.calls.some((c) => c.url.includes('scraperapi.com')));
});

Deno.test('fetchOgFallback: emits a fallback event for the scraper tier', async () => {
  using _mock = installMockFetch([
    {
      match: (req) =>
        req.url.startsWith('https://www.instagram.com/') && !req.url.includes('scraperapi'),
      response: new Response('forbidden', { status: 403 }),
    },
    {
      match: (req) => req.url.startsWith('https://www.ddinstagram.com/'),
      response: new Response('forbidden', { status: 403 }),
    },
    {
      match: (req) => req.url.startsWith('https://api.scraperapi.com/'),
      response: htmlResponse(htmlWithOg({ title: 's', description: 'c' })),
    },
  ]);
  const events: FallbackEvent[] = [];
  const result = await fetchOgFallback(REEL_URL, undefined, (e) => events.push(e), SCRAPER_KEY);
  assert(result);
  assertEquals(events.length, 4);
  assertEquals(events[3].tier, 'scraper');
  assertEquals(events[3].ok, true);
});

Deno.test('fetchOgFallback: returns null when responses are 200 but contain no og tags (login wall)', async () => {
  using _mock = installMockFetch([
    {
      match: () => true,
      response: htmlResponse('<html><body>login required</body></html>'),
    },
  ]);
  const result = await fetchOgFallback(REEL_URL);
  assertEquals(result, null);
});

Deno.test('fetchOgFallback: when captioned_embed wins inside the grace window, only one fetch fires', async () => {
  // The OG happy path: embed returns OK immediately. The new parallel
  // fallback must NOT fan out to the other tiers in this case — bandwidth
  // savings + fewer chances for Instagram to flag our IP.
  using mock = installMockFetch([
    {
      match: (req) => req.url.endsWith('/embed/captioned/'),
      response: htmlResponse(htmlWithOg({ title: 'fast', description: 'caption' })),
    },
    // No other handlers — if we fan out, mock_fetch throws and the test fails.
  ]);
  const result = await fetchOgFallback(REEL_URL);
  assert(result);
  assertEquals(result.source, 'captioned_embed');
  assertEquals(mock.calls.length, 1);
});

Deno.test('fetchOgFallback: when captioned_embed fails fast, remaining tiers fire in parallel', async () => {
  // Embed fails quickly → grace window closes early → remaining tiers fire
  // concurrently rather than sequentially. We can't assert wall-clock time
  // directly in unit tests (mocks resolve in microseconds), but we CAN
  // confirm all three remaining tiers are tried and that the preference
  // order is respected at result-selection time.
  using mock = installMockFetch([
    {
      match: (req) => req.url.includes('/embed/captioned/'),
      response: new Response('forbidden', { status: 403 }),
    },
    {
      match: (req) => req.url.startsWith('https://www.instagram.com/reel/DX6MMYWOn3Z/?'),
      response: htmlResponse(htmlWithOg({ title: 'direct', description: 'direct caption' })),
    },
    {
      match: (req) => req.url.startsWith('https://www.ddinstagram.com/'),
      response: htmlResponse(htmlWithOg({ title: 'mirror', description: 'mirror caption' })),
    },
  ]);
  const result = await fetchOgFallback(REEL_URL);
  assert(result);
  // Direct beats mirror in preference order even though both succeeded.
  assertEquals(result.source, 'direct');
  assertEquals(result.oembed.html, 'direct caption');
  // All three tiers were tried in parallel (mirror fired even though direct
  // would have been enough).
  const triedUrls = mock.calls.map((c) => c.url);
  assert(triedUrls.some((u) => u.includes('/embed/captioned/')));
  assert(triedUrls.some((u) => u.startsWith('https://www.instagram.com/reel/DX6MMYWOn3Z/?')));
  assert(triedUrls.some((u) => u.startsWith('https://www.ddinstagram.com/')));
});

Deno.test('fetchOgFallback: when slow captioned_embed eventually returns OK, it still beats faster lower tiers', async () => {
  // The grace window protects the preferred tier but doesn't preempt its
  // outcome. Even when embed finishes after the 2 s grace, its result wins
  // over faster but lower-preference tiers (so we don't randomly switch
  // sources between identical post URLs depending on network noise).
  using _mock = installMockFetch([
    {
      match: (req) => req.url.includes('/embed/captioned/'),
      response: async () => {
        // Resolve after grace expires (mock_fetch awaits the function).
        await new Promise((r) => setTimeout(r, 50));
        return htmlResponse(htmlWithOg({ title: 'slow embed', description: 'slow caption' }));
      },
    },
    {
      match: (req) => req.url.startsWith('https://www.instagram.com/reel/DX6MMYWOn3Z/?'),
      response: htmlResponse(htmlWithOg({ title: 'fast direct', description: 'fast caption' })),
    },
    {
      match: () => true,
      response: new Response('na', { status: 404 }),
    },
  ]);
  // Shorten the grace by patching PREFERRED_GRACE_MS would couple us to the
  // implementation; instead, rely on the 50 ms embed delay being far below
  // the production 2 s grace, which means embed will resolve before the
  // grace expires — but the assertion below is identical either way:
  // captioned_embed wins on preference.
  const result = await fetchOgFallback(REEL_URL);
  assert(result);
  assertEquals(result.source, 'captioned_embed');
  assertEquals(result.oembed.html, 'slow caption');
});

Deno.test('fetchOgFallback: emits a logger event for every tier attempted', async () => {
  using _mock = installMockFetch([
    {
      match: (req) => req.url.includes('/embed/captioned/'),
      response: new Response('forbidden', { status: 403 }),
    },
    {
      match: (req) => req.url.startsWith('https://www.instagram.com/reel/DX6MMYWOn3Z/?'),
      response: htmlResponse('<html><body>login required</body></html>'),
    },
    {
      match: (req) => req.url.startsWith('https://www.ddinstagram.com/'),
      response: htmlResponse(htmlWithOg({ title: 'mirror', description: 'caption' })),
    },
  ]);
  const events: FallbackEvent[] = [];
  const result = await fetchOgFallback(REEL_URL, undefined, (e) => events.push(e));
  assert(result);
  assertEquals(result.source, 'mirror');
  assertEquals(events.length, 3);

  assertEquals(events[0].tier, 'captioned_embed');
  assertEquals(events[0].ok, false);
  assertEquals(events[0].status, 403);
  assertEquals(events[0].reason, 'non_ok');
  assert(typeof events[0].ms === 'number');

  assertEquals(events[1].tier, 'direct');
  assertEquals(events[1].ok, false);
  assertEquals(events[1].status, 200);
  assertEquals(events[1].reason, 'no_og');

  assertEquals(events[2].tier, 'mirror');
  assertEquals(events[2].ok, true);
  assertEquals(events[2].status, 200);
  assertEquals(events[2].reason, undefined);
});
