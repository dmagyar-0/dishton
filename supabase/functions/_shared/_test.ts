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

Deno.test('corsHeaders echoes the request origin when no allowlist is configured', () => {
  assertEquals(
    corsHeaders('https://app.example')['access-control-allow-origin'],
    'https://app.example',
  );
  assertEquals(corsHeaders(null)['access-control-allow-origin'], '*');
});

Deno.test('corsHeaders enforces the allowlist when configured', () => {
  const allow = ['https://dishton.app', 'https://staging.dishton.app'];
  assertEquals(
    corsHeaders('https://dishton.app', allow)['access-control-allow-origin'],
    'https://dishton.app',
  );
  assertEquals(
    corsHeaders('https://staging.dishton.app', allow)['access-control-allow-origin'],
    'https://staging.dishton.app',
  );
  // Unknown origins get the first allowed entry — the browser then fails the
  // CORS check instead of receiving a reflected wildcard.
  assertEquals(
    corsHeaders('https://evil.example', allow)['access-control-allow-origin'],
    'https://dishton.app',
  );
  assertEquals(corsHeaders(null, allow)['access-control-allow-origin'], 'https://dishton.app');
});
