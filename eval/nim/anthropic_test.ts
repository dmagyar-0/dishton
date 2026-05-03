import { assertEquals } from '@std/assert';
import { AnthropicError, callAnthropic } from './anthropic.ts';

function mockFetch(impl: (req: Request) => Response | Promise<Response>): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' || input instanceof URL ? input.toString() : input.url;
    const req = new Request(url, init);
    return impl(req);
  };
}

Deno.test('anthropic: callAnthropic returns content + usage + latency on 200', async () => {
  const fetchImpl = mockFetch(() =>
    new Response(
      JSON.stringify({
        id: 'msg_x',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: '{"hello":"world"}' }],
        usage: { input_tokens: 100, output_tokens: 20 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  );
  const r = await callAnthropic({
    apiKey: 'test-key',
    model: 'claude-haiku-4-5-20251001',
    messages: [
      { role: 'system', content: 'sys 1' },
      { role: 'user', content: 'hi' },
    ],
    timeoutMs: 5_000,
    fetchImpl,
  });
  assertEquals(r.raw, '{"hello":"world"}');
  assertEquals(r.usage.input, 100);
  assertEquals(r.usage.output, 20);
  assertEquals(typeof r.latencyMs, 'number');
  assertEquals(r.latencyMs >= 0, true);
});

Deno.test('anthropic: extracts system messages and concatenates with \\n\\n', async () => {
  let captured: { url: string; headers: Headers; body: string } | null = null;
  const fetchImpl = mockFetch(async (req) => {
    captured = {
      url: req.url,
      headers: req.headers,
      body: await req.text(),
    };
    return new Response(
      JSON.stringify({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { status: 200 },
    );
  });
  await callAnthropic({
    apiKey: 'test-key',
    model: 'claude-haiku-4-5-20251001',
    messages: [
      { role: 'system', content: 'first sys' },
      { role: 'system', content: 'second sys' },
      { role: 'user', content: 'hello' },
    ],
    timeoutMs: 5_000,
    fetchImpl,
  });
  assertEquals(captured !== null, true);
  const c = captured!;
  assertEquals(c.url, 'https://api.anthropic.com/v1/messages');
  assertEquals(c.headers.get('x-api-key'), 'test-key');
  assertEquals(c.headers.get('anthropic-version'), '2023-06-01');
  const body = JSON.parse(c.body);
  assertEquals(body.system, 'first sys\n\nsecond sys');
  assertEquals(body.messages.length, 1);
  assertEquals(body.messages[0].role, 'user');
  assertEquals(body.messages[0].content, 'hello');
  assertEquals('response_format' in body, false);
});

Deno.test('anthropic: callAnthropic throws AnthropicError(http) on non-2xx', async () => {
  const fetchImpl = mockFetch(() =>
    new Response('rate limited', { status: 429 })
  );
  let caught: unknown;
  try {
    await callAnthropic({
      apiKey: 'test-key',
      model: 'claude-haiku-4-5-20251001',
      messages: [{ role: 'user', content: 'hi' }],
      timeoutMs: 5_000,
      fetchImpl,
    });
  } catch (e) {
    caught = e;
  }
  assertEquals(caught instanceof AnthropicError, true);
  assertEquals((caught as AnthropicError).kind, 'http');
  assertEquals((caught as AnthropicError).status, 429);
});

Deno.test('anthropic: callAnthropic throws AnthropicError(timeout) when timeoutMs elapses', async () => {
  const fetchImpl = mockFetch(
    (req) =>
      new Promise<Response>((_resolve, reject) => {
        req.signal.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
        // never resolve
      }),
  );
  let caught: unknown;
  try {
    await callAnthropic({
      apiKey: 'test-key',
      model: 'claude-haiku-4-5-20251001',
      messages: [{ role: 'user', content: 'hi' }],
      timeoutMs: 50,
      fetchImpl,
    });
  } catch (e) {
    caught = e;
  }
  assertEquals(caught instanceof AnthropicError, true);
  assertEquals((caught as AnthropicError).kind, 'timeout');
});
