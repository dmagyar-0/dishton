// Client-side photo resize that runs before upload. Phone cameras typically
// emit 4–8 MB JPEGs at 4000+ px on the long edge; shrinking to 1600 px /
// q=0.85 cuts upload time and the vision-input token bill without visibly
// degrading recipe legibility.
//
// On any failure (unsupported browser, decode error, OOM) we fall back to
// the original file so the import never blocks on resize trouble.

import * as Sentry from '@sentry/react';

const SKIP_BELOW_BYTES = 500_000;
const MAX_LONG_EDGE_PX = 1600;
const JPEG_QUALITY = 0.85;

export async function resizeForUpload(file: File): Promise<File> {
  if (file.size < SKIP_BELOW_BYTES) return file;
  if (typeof createImageBitmap !== 'function') return file;

  try {
    const bitmap = await createImageBitmap(file);
    try {
      const { width, height } = bitmap;
      const longEdge = Math.max(width, height);
      if (longEdge <= MAX_LONG_EDGE_PX) return file;

      const scale = MAX_LONG_EDGE_PX / longEdge;
      const targetWidth = Math.round(width * scale);
      const targetHeight = Math.round(height * scale);

      const blob = await encode(bitmap, targetWidth, targetHeight);
      if (!blob) return file;

      // Keep upload paths cheap to predict: always JPEG after resize, .jpg
      // extension regardless of the input type. (recipe photos almost never
      // need PNG transparency.)
      const renamed = `${file.name.replace(/\.[^.]+$/, '')}.jpg`;
      return new File([blob], renamed, {
        type: 'image/jpeg',
        lastModified: file.lastModified,
      });
    } finally {
      bitmap.close();
    }
  } catch (err) {
    Sentry.addBreadcrumb({
      category: 'import',
      message: 'import.photo.resize_failed',
      level: 'warning',
      data: {
        size: file.size,
        type: file.type,
        error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
      },
    });
    return file;
  }
}

async function encode(bitmap: ImageBitmap, width: number, height: number): Promise<Blob | null> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, width, height);
    return canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
  }
  // jsdom + older browsers don't ship OffscreenCanvas; fall back to a DOM
  // canvas. document only exists when this module runs in the browser.
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', JPEG_QUALITY);
  });
}
