// Re-host a model-emitted remote hero image into the private recipe-images
// bucket under the importer's own folder.
//
// Why: the importer's draft hero_image_path comes out of an LLM that read an
// untrusted page/caption. Storing the remote URL verbatim turns every
// household member's browser into a client of an attacker-chosen host (a
// prompt-injected page can plant a tracking pixel served to the whole
// household). Fetching it once here — through the SSRF guard — and serving it
// from our own bucket removes that vector while keeping imported hero images.
//
// Failure handling is deliberately lossy: any problem (non-image, oversized,
// SSRF-blocked, upload denied) returns null and the recipe simply has no hero.

import type { AppClient } from '../auth.ts';
import { safeFetch } from './ssrf-guard.ts';
import { type SniffedImageType, sniffImageContentType } from './image-bytes.ts';

// Under the bucket's 5 MiB cap so the platform-side limit never rejects us.
const MAX_HERO_IMAGE_BYTES = 4_500_000;
const REMOTE_URL = /^https?:\/\//i;

const EXTENSIONS: Record<SniffedImageType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

const PREFILTER_TYPES = new Set([...Object.keys(EXTENSIONS), 'application/octet-stream']);

export async function rehostRemoteHeroImage(
  client: AppClient,
  profileId: string,
  heroImagePath: string | null,
): Promise<string | null> {
  // Null and already-hosted storage paths pass through untouched.
  if (heroImagePath === null || !REMOTE_URL.test(heroImagePath)) return heroImagePath;
  try {
    const res = await safeFetch(heroImagePath, {
      method: 'GET',
      headers: { 'user-agent': 'DishtonBot/0.1 (+https://dishton.app)' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok || !res.body) return null;

    // Cheap pre-filter on the declared type so we never stream megabytes of
    // HTML; the magic bytes below are the real gate.
    const declared = (res.headers.get('content-type') ?? '')
      .split(';')[0]
      ?.trim()
      .toLowerCase();
    if (declared && declared !== '' && !PREFILTER_TYPES.has(declared)) return null;

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        total += value.length;
        if (total > MAX_HERO_IMAGE_BYTES) {
          await reader.cancel();
          return null;
        }
        chunks.push(value);
      }
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.length;
    }

    const sniffed = sniffImageContentType(bytes);
    if (sniffed === null) return null;

    // Own-folder path: storage RLS allows the caller-scoped client to write
    // here, and the recipe-linked read policy makes it visible to the
    // household once save_recipe stores the path.
    const path = `${profileId}/${crypto.randomUUID()}.${EXTENSIONS[sniffed]}`;
    const { error } = await client.storage
      .from('recipe-images')
      .upload(path, bytes, { contentType: sniffed, upsert: false });
    if (error) return null;
    return path;
  } catch {
    return null;
  }
}
