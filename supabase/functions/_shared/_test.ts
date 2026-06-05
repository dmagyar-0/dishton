// Regression tests for the shared HTTP/CORS helpers. Run via `pnpm test:edge`.

import { assert, assertEquals } from 'jsr:@std/assert';
import { corsHeaders } from './auth.ts';

Deno.test('corsHeaders allow-headers covers every header supabase-js sends', () => {
  // supabase-js attaches these to every functions.invoke call. If any are
  // missing here, browsers preflight-block the POST and the SPA hangs with
  // no logs reaching the function.
  const required = ['apikey', 'authorization', 'content-type', 'x-client-info'];
  const allowed = corsHeaders(null)['access-control-allow-headers']
    .toLowerCase()
    .split(',')
    .map((s) => s.trim());
  for (const h of required) {
    assert(allowed.includes(h), `missing ${h} in access-control-allow-headers`);
  }
});

Deno.test('corsHeaders echoes the request origin when present', () => {
  assertEquals(
    corsHeaders('https://app.example')['access-control-allow-origin'],
    'https://app.example',
  );
  assertEquals(corsHeaders(null)['access-control-allow-origin'], '*');
});
