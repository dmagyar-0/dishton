import { assertEquals } from 'jsr:@std/assert';
import { sniffImageContentType } from './image-bytes.ts';

function bytes(...values: (number | string)[]): Uint8Array {
  const out: number[] = [];
  for (const v of values) {
    if (typeof v === 'number') out.push(v);
    else for (const ch of v) out.push(ch.charCodeAt(0));
  }
  return new Uint8Array(out);
}

Deno.test('sniffs JPEG', () => {
  assertEquals(
    sniffImageContentType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0)),
    'image/jpeg',
  );
});

Deno.test('sniffs PNG', () => {
  assertEquals(
    sniffImageContentType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0)),
    'image/png',
  );
});

Deno.test('sniffs WEBP', () => {
  assertEquals(sniffImageContentType(bytes('RIFF', 0, 0, 0, 0, 'WEBP')), 'image/webp');
});

Deno.test('sniffs AVIF', () => {
  assertEquals(sniffImageContentType(bytes(0, 0, 0, 0x20, 'ftyp', 'avif')), 'image/avif');
});

Deno.test('rejects HTML masquerading as an image', () => {
  assertEquals(sniffImageContentType(bytes('<!doctype html><html>')), null);
});

Deno.test('rejects short buffers', () => {
  assertEquals(sniffImageContentType(bytes(0xff)), null);
});
