import { assert, assertEquals } from '@std/assert';
import { callAnthropic } from './anthropic.ts';

type Captured = { body?: Record<string, unknown> };

function mockFetch(
  captured: Captured,
  content: Array<Record<string, unknown>>,
): typeof fetch {
  return ((_url: string | URL | Request, init?: RequestInit) => {
    captured.body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const resp = {
      content,
      stop_reason: 'tool_use',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 10,
        cache_creation_input_tokens: 5,
      },
    };
    return Promise.resolve(
      new Response(JSON.stringify(resp), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;
}

const TOOL_BLOCK = { type: 'tool_use', id: 'tu', name: 'extract_recipe', input: { title: 'X' } };

Deno.test('opus: omits temperature, sends adaptive thinking + effort, caches system', async () => {
  const cap: Captured = {};
  const r = await callAnthropic({
    apiKey: 'k',
    model: 'claude-opus-4-8',
    messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }],
    timeoutMs: 5000,
    temperature: 0.1,
    thinking: 'adaptive',
    effort: 'high',
    tools: [{ name: 'extract_recipe' }],
    toolChoice: { type: 'auto' },
    fetchImpl: mockFetch(cap, [{ type: 'thinking', thinking: '' }, TOOL_BLOCK]),
  });
  assertEquals(cap.body?.temperature, undefined);
  assertEquals(cap.body?.thinking, { type: 'adaptive' });
  assertEquals(cap.body?.output_config, { effort: 'high' });
  assert(Array.isArray(cap.body?.system));
  assertEquals(r.usedTool, true);
  assertEquals(r.raw, JSON.stringify({ title: 'X' }));
  assertEquals(r.usage.input, 100);
  assertEquals(r.usage.cacheRead, 10);
  assertEquals(r.usage.cacheWrite, 5);
});

Deno.test('haiku: forced tool_choice + temperature pass through, no thinking', async () => {
  const cap: Captured = {};
  await callAnthropic({
    apiKey: 'k',
    model: 'claude-haiku-4-5',
    messages: [{ role: 'user', content: 'hi' }],
    timeoutMs: 5000,
    temperature: 0.1,
    tools: [{ name: 'extract_recipe' }],
    toolChoice: { type: 'tool', name: 'extract_recipe' },
    fetchImpl: mockFetch(cap, [TOOL_BLOCK]),
  });
  assertEquals(cap.body?.temperature, 0.1);
  assertEquals(cap.body?.tool_choice, { type: 'tool', name: 'extract_recipe' });
  assert(!('thinking' in (cap.body ?? {})));
  assert(!('output_config' in (cap.body ?? {})));
});

Deno.test('falls back to concatenated text when no tool block present', async () => {
  const cap: Captured = {};
  const r = await callAnthropic({
    apiKey: 'k',
    model: 'claude-sonnet-4-6',
    messages: [{ role: 'user', content: 'hi' }],
    timeoutMs: 5000,
    tools: [{ name: 'extract_recipe' }],
    toolChoice: { type: 'auto' },
    fetchImpl: mockFetch(cap, [{ type: 'text', text: '{"a":1}' }]),
  });
  assertEquals(r.usedTool, false);
  assertEquals(r.raw, '{"a":1}');
});
