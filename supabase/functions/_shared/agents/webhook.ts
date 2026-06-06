// Verifies Anthropic webhook signatures (Svix-style: webhook-id /
// webhook-timestamp / webhook-signature headers; HMAC-SHA256 over
// `${id}.${timestamp}.${rawBody}` with the base64 secret after the whsec_
// prefix). Implemented with Web Crypto + atob/btoa to avoid pulling the SDK or
// an encoding dependency into the edge runtime.

function b64decode(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
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
    b64decode(signingSecret.slice('whsec_'.length)),
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
