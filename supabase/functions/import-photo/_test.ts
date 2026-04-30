// Tests for import-photo. NIM vision is mocked.

import { assert } from 'jsr:@std/assert';
import { installMockFetch, jsonResponse } from '../_shared/mock_fetch.ts';

Deno.test('import-photo: vision NIM happy path', async () => {
  using mock = installMockFetch([
    {
      match: (req) => req.url.includes('integrate.api.nvidia.com'),
      response: jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: 'Granny\'s Cookies',
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
          },
        ],
        usage: { prompt_tokens: 2000, completion_tokens: 800 },
      }),
    },
  ]);
  const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', { method: 'POST' });
  const json = await res.json();
  assert(json.choices[0].message.content.includes('Granny'));
  assert(mock.calls.length === 1);
});
