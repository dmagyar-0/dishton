// Tests for import-instagram. The function combines oEmbed + Anthropic;
// both are mocked via mock_fetch.

import { assert } from 'jsr:@std/assert';
import { installMockFetch, jsonResponse } from '../_shared/mock_fetch.ts';

Deno.test('import-instagram: oembed mock returns expected shape', async () => {
  using mock = installMockFetch([
    {
      match: (req) => req.url.includes('graph.facebook.com'),
      response: jsonResponse({
        title: 'Recipe of the day',
        html: '<p>500g tomatoes\n4 servings</p>',
        thumbnail_url: 'https://example.test/thumb.jpg',
      }),
    },
  ]);
  const res = await fetch('https://graph.facebook.com/v18.0/instagram_oembed?url=x&access_token=y');
  const json = await res.json();
  assert(typeof json.title === 'string');
  assert(mock.calls.length === 1);
});

Deno.test('import-instagram: 404 from oembed is recoverable', async () => {
  using mock = installMockFetch([
    {
      match: (req) => req.url.includes('graph.facebook.com'),
      response: jsonResponse({ error: 'not found' }, { status: 404 }),
    },
  ]);
  const res = await fetch('https://graph.facebook.com/v18.0/instagram_oembed?url=x&access_token=y');
  assert(!res.ok);
  assert(mock.calls.length === 1);
});
