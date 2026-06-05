// Unit tests for charset-aware HTML body decoding. Run via `pnpm test:edge`.

import { assert, assertEquals } from 'jsr:@std/assert';
import { charsetFromContentType, decodeHtmlBody } from './decode-body.ts';

Deno.test('charsetFromContentType extracts the charset token', () => {
  assertEquals(charsetFromContentType('text/html; charset=ISO-8859-1'), 'iso-8859-1');
  assertEquals(charsetFromContentType('text/html;charset="windows-1250"'), 'windows-1250');
  assertEquals(charsetFromContentType('text/html'), null);
  assertEquals(charsetFromContentType(null), null);
});

Deno.test('decodeHtmlBody honours the Content-Type charset', () => {
  // 0xE9 is "é" in ISO-8859-1; decoding as UTF-8 would mojibake it.
  const bytes = new Uint8Array([0x63, 0x72, 0xe8, 0x6d, 0x65]); // "crème" in latin-1
  const out = decodeHtmlBody(bytes, 'text/html; charset=iso-8859-1');
  assertEquals(out, 'crème');
});

Deno.test('decodeHtmlBody sniffs a meta charset when header is silent', () => {
  const head = '<!doctype html><meta charset="iso-8859-1"><title>x</title>';
  const tail = new Uint8Array([0xe9]); // "é" in latin-1
  const bytes = new Uint8Array([...new TextEncoder().encode(head), ...tail]);
  const out = decodeHtmlBody(bytes, 'text/html');
  assert(out.includes('é'), `expected decoded é, got: ${out}`);
});

Deno.test('decodeHtmlBody defaults to UTF-8 and falls back on bad label', () => {
  const bytes = new TextEncoder().encode('héllo');
  assertEquals(decodeHtmlBody(bytes, 'text/html'), 'héllo');
  assertEquals(decodeHtmlBody(bytes, 'text/html; charset=totally-bogus'), 'héllo');
});
