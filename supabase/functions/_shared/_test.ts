// Regression tests for the shared HTTP/CORS helpers. Run via `pnpm test:edge`.

import { assert, assertEquals, assertRejects } from 'jsr:@std/assert';
import { corsHeaders, HttpError } from './auth.ts';
import { withTimeout } from './timeout.ts';

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

Deno.test('withTimeout resolves with fn value when fn finishes in time', async () => {
  const out = await withTimeout(50, undefined, async () => {
    await new Promise((r) => setTimeout(r, 5));
    return 'ok';
  });
  assertEquals(out, 'ok');
});

Deno.test('withTimeout throws HttpError(504,"timeout") when fn exceeds ms', async () => {
  const err = await assertRejects(
    () =>
      withTimeout(20, undefined, async (signal) => {
        await new Promise((resolve, reject) => {
          const t = setTimeout(resolve, 200);
          signal.addEventListener('abort', () => {
            clearTimeout(t);
            reject(signal.reason);
          });
        });
        return 'never';
      }),
    HttpError,
  );
  assertEquals(err.status, 504);
  assertEquals(err.code, 'timeout');
});

Deno.test('withTimeout signal fires when timeout elapses', async () => {
  let aborted = false;
  await assertRejects(() =>
    withTimeout(20, undefined, async (signal) => {
      signal.addEventListener('abort', () => { aborted = true; });
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, 100);
        signal.addEventListener('abort', () => {
          clearTimeout(t);
          reject(signal.reason);
        });
      });
      return 'never';
    }),
  );
  assert(aborted, 'inner signal should abort when timer fires');
});

Deno.test('withTimeout signal fires when parent aborts', async () => {
  const parent = new AbortController();
  let innerAborted = false;
  const promise = withTimeout(1000, parent.signal, async (signal) => {
    signal.addEventListener('abort', () => { innerAborted = true; });
    await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
    return 'never';
  });
  setTimeout(() => parent.abort(new Error('client closed')), 10);
  await assertRejects(() => promise);
  assert(innerAborted, 'inner signal should abort when parent aborts');
});

Deno.test('withTimeout does not abort when fn resolves before timer', async () => {
  // Deno fails the test if any timer leaks past the test boundary, so an
  // unrelated 1-second timer in withTimeout that isn't cleared on resolve
  // would surface as a leak here.
  let aborted = false;
  await withTimeout(1_000, undefined, async (signal) => {
    signal.addEventListener('abort', () => { aborted = true; });
    return 'fast';
  });
  assertEquals(aborted, false);
});
