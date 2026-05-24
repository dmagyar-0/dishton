import { describe, expect, it, vi } from 'vitest';
import { resizeForUpload } from './photo-resize';

vi.mock('@sentry/react', () => ({
  addBreadcrumb: vi.fn(),
}));

function makeFile(size: number, type = 'image/jpeg', name = 'photo.jpg'): File {
  const buf = new Uint8Array(size);
  return new File([buf], name, { type, lastModified: 1700000000000 });
}

describe('resizeForUpload', () => {
  it('returns the original file when smaller than 500 KB', async () => {
    const small = makeFile(400_000);
    const out = await resizeForUpload(small);
    expect(out).toBe(small);
  });

  it('returns the original file when createImageBitmap is unavailable', async () => {
    const orig = (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
    (globalThis as { createImageBitmap?: unknown }).createImageBitmap = undefined;
    try {
      const large = makeFile(2_000_000);
      const out = await resizeForUpload(large);
      expect(out).toBe(large);
    } finally {
      (globalThis as { createImageBitmap?: unknown }).createImageBitmap = orig;
    }
  });

  it('returns the original file when the bitmap is already at-or-below the long-edge cap', async () => {
    // 1200 px on the long edge: under the 1600 cap → no resize needed.
    const stub = vi.fn(async () => ({
      width: 1200,
      height: 900,
      close: vi.fn(),
    })) as unknown as typeof createImageBitmap;
    (globalThis as { createImageBitmap?: unknown }).createImageBitmap = stub;
    try {
      const orig = makeFile(2_000_000);
      const out = await resizeForUpload(orig);
      expect(out).toBe(orig);
    } finally {
      (globalThis as { createImageBitmap?: unknown }).createImageBitmap = undefined;
    }
  });

  it('returns a new JPEG file when the bitmap exceeds the long-edge cap', async () => {
    const close = vi.fn();
    (globalThis as { createImageBitmap?: unknown }).createImageBitmap = vi.fn(async () => ({
      width: 4000,
      height: 3000,
      close,
    }));
    const drawImage = vi.fn();
    const convertToBlob = vi.fn(
      async () => new Blob([new Uint8Array(123)], { type: 'image/jpeg' }),
    );
    (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = vi.fn(function (
      this: {
        width: number;
        height: number;
        getContext: () => unknown;
        convertToBlob: typeof convertToBlob;
      },
      width: number,
      height: number,
    ) {
      this.width = width;
      this.height = height;
      this.getContext = () => ({ drawImage });
      this.convertToBlob = convertToBlob;
    });

    try {
      const orig = makeFile(2_000_000, 'image/jpeg', 'IMG_1234.HEIC.jpg');
      const out = await resizeForUpload(orig);
      expect(out).not.toBe(orig);
      expect(out.type).toBe('image/jpeg');
      expect(out.name).toBe('IMG_1234.HEIC.jpg');
      expect(close).toHaveBeenCalled();
      // Long-edge 4000 → scale to 1600 = 0.4; height 3000 * 0.4 = 1200.
      expect(convertToBlob).toHaveBeenCalledWith({ type: 'image/jpeg', quality: 0.85 });
    } finally {
      (globalThis as { createImageBitmap?: unknown }).createImageBitmap = undefined;
      (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = undefined;
    }
  });

  it('falls back to the original file when bitmap creation throws', async () => {
    (globalThis as { createImageBitmap?: unknown }).createImageBitmap = vi.fn(async () => {
      throw new Error('decode failed');
    });
    try {
      const orig = makeFile(2_000_000);
      const out = await resizeForUpload(orig);
      expect(out).toBe(orig);
    } finally {
      (globalThis as { createImageBitmap?: unknown }).createImageBitmap = undefined;
    }
  });

  it('renames a .png input to .jpg after resize', async () => {
    const close = vi.fn();
    (globalThis as { createImageBitmap?: unknown }).createImageBitmap = vi.fn(async () => ({
      width: 4000,
      height: 3000,
      close,
    }));
    (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = vi.fn(function (
      this: {
        width: number;
        height: number;
        getContext: () => unknown;
        convertToBlob: () => Promise<Blob>;
      },
      width: number,
      height: number,
    ) {
      this.width = width;
      this.height = height;
      this.getContext = () => ({ drawImage: vi.fn() });
      this.convertToBlob = async () => new Blob([new Uint8Array(64)], { type: 'image/jpeg' });
    });
    try {
      const orig = makeFile(2_000_000, 'image/png', 'recipe.png');
      const out = await resizeForUpload(orig);
      expect(out.name).toBe('recipe.jpg');
      expect(out.type).toBe('image/jpeg');
    } finally {
      (globalThis as { createImageBitmap?: unknown }).createImageBitmap = undefined;
      (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = undefined;
    }
  });
});
