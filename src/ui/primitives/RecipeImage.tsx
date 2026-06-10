import { isRemoteImageUrl, useImageUrl } from '@/lib/queries/storage';
import type { ImgHTMLAttributes } from 'react';

export type RecipeImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  // A recipe hero_image_path: either a remote http(s) URL (used verbatim) or a
  // storage object path in the private recipe-images bucket (signed on demand).
  path: string | null | undefined;
};

// Renders a hero image, resolving private-bucket storage paths to short-lived
// signed URLs. Renders nothing until a URL is available so we never flash a
// broken-image icon for a path that is still being signed.
export function RecipeImage({ path, alt = '', ...rest }: RecipeImageProps) {
  const url = useImageUrl(path);
  if (!url) return null;
  // Storage-bucket images are fetched with CORS so the service worker caches
  // a real 200 instead of an opaque response (opaque entries are quota-padded
  // ~7 MB each in Chromium). Legacy remote heroes stay no-cors — third-party
  // hosts don't reliably send CORS headers and would fail to render at all.
  const crossOrigin = path && !isRemoteImageUrl(path) ? ('anonymous' as const) : undefined;
  // `alt` is positioned last so a spread rest can never override it.
  return <img crossOrigin={crossOrigin} {...rest} src={url} alt={alt} />;
}
