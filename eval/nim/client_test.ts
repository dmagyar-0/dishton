import { assertEquals } from '@std/assert';
import { callNim, NimError } from './client.ts';

function mockFetch(impl: (req: Request) => Response | Promise<Response>): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' || input instanceof URL ? input.toString() : input.url;
    const req = new Request(url, init);
    return impl(req);
  };
}

Deno.test('client: callNim returns content + usage + latency on 200', async () => {
  const fetchImpl = mockFetch(() =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"hello":"world"}' } }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  );
  const r = await callNim({
    apiKey: 'test-key',
    model: 'm',
    messages: [{ role: 'user', content: 'hi' }],
    timeoutMs: 5_000,
    fetchImpl,
  });
  assertEquals(r.raw, '{"hello":"world"}');
  assertEquals(r.usage.input, 100);
  assertEquals(r.usage.output, 20);
  assertEquals(typeof r.latencyMs, 'number');
  assertEquals(r.latencyMs >= 0, true);
});

Deno.test('client: callNim throws NimError(http) on non-2xx', async () => {
  const fetchImpl = mockFetch(() =>
    new Response('upstream broke', { status: 500 })
  );
  let caught: unknown;
  try {
    await callNim({
      apiKey: 'test-key',
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      timeoutMs: 5_000,
      fetchImpl,
    });
  } catch (e) {
    caught = e;
  }
  assertEquals(caught instanceof NimError, true);
  assertEquals((caught as NimError).kind, 'http');
  assertEquals((caught as NimError).status, 500);
});

Deno.test('client: callNim throws NimError(timeout) when timeoutMs elapses', async () => {
  const fetchImpl = mockFetch(
    (req) =>
      new Promise<Response>((resolve, reject) => {
        req.signal.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
        // never resolve
      }),
  );
  let caught: unknown;
  try {
    await callNim({
      apiKey: 'test-key',
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      timeoutMs: 50,
      fetchImpl,
    });
  } catch (e) {
    caught = e;
  }
  assertEquals(caught instanceof NimError, true);
  assertEquals((caught as NimError).kind, 'timeout');
});
