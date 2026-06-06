import { assertEquals } from 'jsr:@std/assert';

Deno.env.set('SUPABASE_URL', 'https://test.supabase.co');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-role');
Deno.env.set('ANTHROPIC_API_KEY', 'test-key');
Deno.env.set('ANTHROPIC_WEBHOOK_SIGNING_KEY', `whsec_${btoa('test')}`);

import { handler } from './handler.ts';

Deno.test('webhook rejects an unsigned request with 400', async () => {
  const res = await handler(
    new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ type: 'event', id: 'e1', data: { type: 'session.status_idled', id: 'sesn_x' } }),
    }),
  );
  assertEquals(res.status, 400);
});

Deno.test('webhook rejects non-POST with 405', async () => {
  const res = await handler(new Request('http://localhost', { method: 'GET' }));
  assertEquals(res.status, 405);
});
