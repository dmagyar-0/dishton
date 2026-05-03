// Tests for import-photo. Anthropic vision is mocked.

import { assert } from 'jsr:@std/assert';
import { installMockFetch, jsonResponse } from '../_shared/mock_fetch.ts';

Deno.test('import-photo: vision Anthropic happy path', async () => {
  using mock = installMockFetch([
    {
      match: (req) => req.url.includes('api.anthropic.com'),
      response: jsonResponse({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'claude-haiku-4-5',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              title: "Granny's Cookies",
              description: null,
              source_type: 'photo',
              source_url: null,
              source_language: 'en',
              canonical_unit_system: 'imperial',
              servings: 12,
              total_time_min: 25,
              hero_image_path: null,
              tags: [],
              ingredients: [],
              steps: [{ position: 0, body: 'Bake.', duration_min: null }],
            }),
          },
        ],
        stop_reason: 'end_turn',
        usage: { input_tokens: 2000, output_tokens: 800 },
      }),
    },
  ]);
  const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST' });
  const json = await res.json();
  assert(json.content[0].text.includes('Granny'));
  assert(mock.calls.length === 1);
});
