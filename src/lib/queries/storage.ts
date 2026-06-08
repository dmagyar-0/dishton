import { useQuery } from '@tanstack/react-query';
import { supabase } from '../supabase';

// The recipe-images bucket is PRIVATE (see supabase/config.toml). Objects we
// store there — avatars at `<uid>/avatar.*` and promoted hero images — must be
// fetched through short-lived signed URLs. Externally-imported hero images are
// stored as full remote http(s) URLs and must be used verbatim.

export const RECIPE_IMAGES_BUCKET = 'recipe-images';
// One hour. Long enough to cover a page session without re-minting; short
// enough that a leaked URL expires quickly.
const SIGNED_URL_TTL_SECONDS = 3600;

// A value is a remote URL (use as-is) when it has an http(s) scheme; otherwise
// it is treated as a storage object path inside the recipe-images bucket.
export function isRemoteImageUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

// Given the hero_image_path a recipe had when an edit began (`previous`) and the
// path after saving (`next`), return the owned bucket object that is now
// orphaned and safe to delete, or null when there is nothing to free. Remote
// (imported) URLs are never ours to delete, and an unchanged path is still
// referenced.
export function staleHeroImagePath(previous: string | null, next: string | null): string | null {
  if (!previous || previous === next) return null;
  if (isRemoteImageUrl(previous)) return null;
  return previous;
}

// Resolve a hero_image_path / avatar_url to a displayable URL. Remote URLs are
// returned unchanged; storage paths are exchanged for a signed URL. Returns
// null when there is nothing to show or the signing call fails.
export async function resolveImageUrl(value: string | null | undefined): Promise<string | null> {
  if (!value) return null;
  if (isRemoteImageUrl(value)) return value;
  const { data, error } = await supabase.storage
    .from(RECIPE_IMAGES_BUCKET)
    .createSignedUrl(value, SIGNED_URL_TTL_SECONDS);
  if (error || !data) return null;
  return data.signedUrl;
}

// React hook wrapping resolveImageUrl. Caches per path so the same hero/avatar
// rendered in multiple places shares one signed URL until it goes stale.
export function useImageUrl(value: string | null | undefined): string | null {
  const q = useQuery({
    queryKey: ['image-url', value ?? null],
    enabled: value != null && value !== '',
    // Re-mint a little before the signed URL expires.
    staleTime: (SIGNED_URL_TTL_SECONDS - 300) * 1000,
    queryFn: () => resolveImageUrl(value),
  });
  // Remote URLs resolve synchronously inside resolveImageUrl, but the query is
  // async; surface the verbatim URL immediately for the remote case so the
  // image does not flash empty while the (no-op) query settles.
  if (value && isRemoteImageUrl(value)) return value;
  return q.data ?? null;
}
