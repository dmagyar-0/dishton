// Unit tests for callAndValidate's tool-call + bounded schema-repair loop.
// Anthropic is mocked at the fetch layer (the SDK calls globalThis.fetch).
// Run via `pnpm test:edge`.

import { assert, assertEquals } from 'jsr:@std/assert';
import { installMockFetch, jsonResponse } from '../mock_fetch.ts';
import { callAndValidate } from './validate.ts';
import type { AiCallOpts } from './client.ts';

// The env loader is lazy (a Proxy that loads on first access, which happens
// when the Anthropic client is constructed inside the first call). Set the
// required secrets before any test runs; CI provides none for the edge suite.
Deno.env.set('ANTHROPIC_API_KEY', 'test-key');
Deno.env.set('SUPABASE_URL', 'https://test.supabase.co');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-role');

// A draft that passes Recipe.safeParse.
function validRecipe(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Mock Tarte',
    description: null,
    source_type: 'url',
    source_url: 'https://example.test/x',
    source_language: 'en',
    canonical_unit_system: 'metric',
    servings: 4,
    total_time_min: 30,
    hero_image_path: null,
    tags: [],
    ingredients: [
      {
        position: 0,
        raw_text: '500 g tomatoes',
        quantity: 500,
        unit: 'g',
        ingredient_name: 'tomatoes',
        notes: null,
        scalable: true,
        non_scalable_qty: null,
        section: null,
      },
    ],
    steps: [{ position: 0, body: 'Mix.', duration_min: 5 }],
    ...overrides,
  };
}

// An Anthropic message whose single content block is a forced tool_use.
function toolUseResponse(
  input: unknown,
  opts: { model?: string; usage?: { input: number; output: number } } = {},
): Response {
  return jsonResponse({
    id: 'msg_x',
    type: 'message',
    role: 'assistant',
    model: opts.model ?? 'claude-haiku-4-5',
    content: [{ type: 'tool_use', id: 'tu_1', name: 'extract_recipe', input }],
    stop_reason: 'tool_use',
    usage: {
      input_tokens: opts.usage?.input ?? 1000,
      output_tokens: opts.usage?.output ?? 500,
    },
  });
}

// A text-only response (model failed to call the tool).
function textResponse(text: string): Response {
  return jsonResponse({
    id: 'msg_x',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-4-5',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 10 },
  });
}

// Return canned responses in order across successive fetches.
function sequence(responses: Response[]): () => Response {
  let i = 0;
  return () => {
    const res = responses[i++];
    if (!res) throw new Error('mock_fetch: more Anthropic calls than canned responses');
    return res;
  };
}

function anthropic(responses: Response[]) {
  return installMockFetch([
    { match: (req) => req.url.includes('api.anthropic.com'), response: sequence(responses) },
  ]);
}

const BASE_OPTS: AiCallOpts = {
  lane: 'text',
  estimatedTokens: 100,
  messages: [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'extract this' },
  ],
};

Deno.test('callAndValidate: valid first response succeeds without a repair turn', async () => {
  using mock = anthropic([toolUseResponse(validRecipe())]);
  const res = await callAndValidate(BASE_OPTS);
  assert(res.ok, JSON.stringify(res));
  if (res.ok) assertEquals(res.recipe.title, 'Mock Tarte');
  assertEquals(mock.calls.length, 1);
});

Deno.test('callAndValidate: schema failure triggers one repair turn that succeeds', async () => {
  // First draft is invalid (servings as a string); repaired draft is valid.
  using mock = anthropic([
    toolUseResponse(validRecipe({ servings: 'four' }), { usage: { input: 1000, output: 500 } }),
    toolUseResponse(validRecipe(), { model: 'claude-haiku-4-5', usage: { input: 200, output: 100 } }),
  ]);
  const res = await callAndValidate(BASE_OPTS);
  assert(res.ok, JSON.stringify(res));
  assertEquals(mock.calls.length, 2);
  if (res.ok) {
    assertEquals(res.recipe.servings, 4);
    // Usage is summed across the original + repair call.
    assertEquals(res.usage.input, 1200);
    assertEquals(res.usage.output, 600);
  }
});

Deno.test('callAndValidate: the repair turn replays the prompt and feeds back the Zod errors', async () => {
  using mock = anthropic([
    toolUseResponse(validRecipe({ servings: 'four' })),
    toolUseResponse(validRecipe()),
  ]);
  await callAndValidate(BASE_OPTS);
  assertEquals(mock.calls.length, 2);
  const repairBody = await mock.calls[1]!.json();
  const roles = repairBody.messages.map((m: { role: string }) => m.role);
  // Original user turn, the model's failed draft as an assistant turn, then the
  // repair instruction as a user turn — roles must still alternate.
  assertEquals(roles, ['user', 'assistant', 'user']);
  const repairText = JSON.stringify(repairBody.messages.at(-1));
  assert(repairText.includes('failed schema validation'), 'repair turn states the failure');
  assert(repairText.includes('servings'), 'repair turn names the failing field');
});

Deno.test('callAndValidate: schema failure twice surfaces reason=schema after one repair', async () => {
  using mock = anthropic([
    toolUseResponse(validRecipe({ servings: 'four' })),
    toolUseResponse(validRecipe({ servings: 'still bad' })),
  ]);
  const res = await callAndValidate(BASE_OPTS);
  assert(!res.ok);
  if (!res.ok) assertEquals(res.reason, 'schema');
  // Capped at a single repair: exactly two calls, never a third.
  assertEquals(mock.calls.length, 2);
});

Deno.test('callAndValidate: a text-only (no tool call) response is not repaired', async () => {
  using mock = anthropic([textResponse('I cannot find a recipe here.')]);
  const res = await callAndValidate(BASE_OPTS);
  assert(!res.ok);
  if (!res.ok) {
    assertEquals(res.reason, 'parse');
    assertEquals(res.raw, 'I cannot find a recipe here.');
  }
  // No candidate object to repair, so no second call.
  assertEquals(mock.calls.length, 1);
});
