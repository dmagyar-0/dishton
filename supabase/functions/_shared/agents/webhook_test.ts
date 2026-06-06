import { assert, assertEquals } from 'jsr:@std/assert';
import { verifyWebhook } from './webhook.ts';

const RAW_SECRET = 'topsecret';
const SECRET = `whsec_${btoa(RAW_SECRET)}`;

function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

async function sign(id: string, ts: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(RAW_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${body}`));
  return `v1,${b64encode(new Uint8Array(mac))}`;
}

Deno.test('verifyWebhook accepts a valid signature', async () => {
  const body = JSON.stringify({ type: 'event', id: 'event_1' });
  const id = 'msg_1';
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = await sign(id, ts, body);
  const ok = await verifyWebhook(SECRET, body, {
    'webhook-id': id,
    'webhook-timestamp': ts,
    'webhook-signature': sig,
  });
  assert(ok);
});

Deno.test('verifyWebhook rejects a tampered body', async () => {
  const id = 'msg_1';
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = await sign(id, ts, '{"a":1}');
  const ok = await verifyWebhook(SECRET, '{"a":2}', {
    'webhook-id': id,
    'webhook-timestamp': ts,
    'webhook-signature': sig,
  });
  assertEquals(ok, false);
});

Deno.test('verifyWebhook rejects a stale timestamp', async () => {
  const body = '{}';
  const id = 'msg_1';
  const ts = String(Math.floor(Date.now() / 1000) - 10_000);
  const sig = await sign(id, ts, body);
  const ok = await verifyWebhook(SECRET, body, {
    'webhook-id': id,
    'webhook-timestamp': ts,
    'webhook-signature': sig,
  });
  assertEquals(ok, false);
});

Deno.test('verifyWebhook rejects missing headers', async () => {
  const ok = await verifyWebhook(SECRET, '{}', {});
  assertEquals(ok, false);
});
