import { assertEquals } from 'jsr:@std/assert';

Deno.env.set('SUPABASE_URL', 'https://test.supabase.co');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-role');
Deno.env.set('ANTHROPIC_API_KEY', 'test-key');

import { handler } from './handler.ts';

Deno.test('recipe-chat-send rejects a request with no auth header', async () => {
  const res = await handler(
    new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({
        message: 'hi',
        household_id: '00000000-0000-0000-0000-000000000001',
      }),
    }),
  );
  assertEquals(res.status, 401);
});

Deno.test('recipe-chat-send answers OPTIONS preflight with CORS', async () => {
  const res = await handler(new Request('http://localhost', { method: 'OPTIONS' }));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
});
