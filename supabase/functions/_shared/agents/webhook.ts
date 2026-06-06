// Verifies Anthropic webhook signatures (Svix-style: webhook-id /
// webhook-timestamp / webhook-signature headers; HMAC-SHA256 over
// `${id}.${timestamp}.${rawBody}` with the base64 secret after the whsec_
// prefix). Implemented with Web Crypto + atob/btoa to avoid pulling the SDK or
// an encoding dependency into the edge runtime.

// Returns a real ArrayBuffer (not a generically-typed Uint8Array). ArrayBuffer
// is unambiguously a BufferSource on both Deno 1.46 (CI) and 2.x (local), so
// crypto.subtle.importKey accepts it without the `Uint8Array<ArrayBuffer>`
// generic that older TypeScript rejects with TS2315.
function b64ToBytes(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return buf;
}

function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

// Constant-time compare of two strings.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyWebhook(
  signingSecret: string,
  rawBody: string,
  h: {
    'webhook-id'?: string;
    'webhook-timestamp'?: string;
    'webhook-signature'?: string;
  },
): Promise<boolean> {
  const id = h['webhook-id'];
  const ts = h['webhook-timestamp'];
  const sigHeader = h['webhook-signature'];
  if (!id || !ts || !sigHeader || !signingSecret.startsWith('whsec_')) return false;

  // Reject deliveries older than ~5 minutes.
  const ageSec = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(ageSec) || ageSec > 300) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    b64ToBytes(signingSecret.slice('whsec_'.length)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${id}.${ts}.${rawBody}`),
  );
  const expected = b64encode(new Uint8Array(mac));

  // The header may carry multiple space-separated "v1,<sig>" entries.
  return sigHeader.split(' ').some((entry) => {
    const [, sig] = entry.split(',');
    return sig ? safeEqual(sig, expected) : false;
  });
}
