import { useImageUrl } from '@/lib/queries/storage';
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
  // `alt` is positioned last so a spread rest can never override it.
  return <img {...rest} src={url} alt={alt} />;
}
