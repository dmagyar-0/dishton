import { assert, assertEquals } from 'jsr:@std/assert';
import { installMockFetch, jsonResponse } from '../mock_fetch.ts';

// All REQUIRED env keys must exist before the env proxy loads on first access.
Deno.env.set('ANTHROPIC_API_KEY', 'test-key');
Deno.env.set('SUPABASE_URL', 'https://test.supabase.co');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-role');

Deno.test('createSession posts to /v1/sessions with the beta header', async () => {
  Deno.env.delete('AI_MOCK_MODE');
  const { createSession } = await import('./transport.ts');
  using mock = installMockFetch([
    {
      match: (r) => r.url.endsWith('/v1/sessions'),
      response: () => jsonResponse({ id: 'sesn_1', status: 'running' }),
    },
  ]);
  const s = await createSession({ agentId: 'agent_1', environmentId: 'env_1' });
  assertEquals(s.id, 'sesn_1');
  const req = mock.calls[0]!;
  assertEquals(req.headers.get('anthropic-beta'), 'managed-agents-2026-04-01');
  assertEquals(req.headers.get('x-api-key'), 'test-key');
});

Deno.test('mock mode returns a canned session without any fetch', async () => {
  Deno.env.set('AI_MOCK_MODE', '1');
  const { createSession } = await import('./transport.ts');
  const s = await createSession({ agentId: 'a', environmentId: 'e' });
  assert(s.id.startsWith('sesn_mock'));
  Deno.env.delete('AI_MOCK_MODE');
});
