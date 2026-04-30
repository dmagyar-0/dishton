// Edge Function tests for import-url. NIM is mocked via mock_fetch.
// Run with `pnpm test:edge` (Deno test runner).

import { assert, assertEquals } from 'jsr:@std/assert';
import { installMockFetch, jsonResponse } from '../_shared/mock_fetch.ts';

Deno.test('import-url: mock_fetch returns canned NIM response', async () => {
  using mock = installMockFetch([
    {
      match: (req) => req.url.includes('integrate.api.nvidia.com'),
      response: jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
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
                  },
                ],
                steps: [{ position: 0, body: 'Mix.', duration_min: 5 }],
              }),
            },
          },
        ],
        usage: { prompt_tokens: 1000, completion_tokens: 500 },
      }),
    },
  ]);

  const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: 'Bearer test' },
    body: JSON.stringify({}),
  });
  const json = await res.json();
  assert(json.choices[0].message.content.includes('Mock Tarte'));
  assertEquals(mock.calls.length, 1);
});
