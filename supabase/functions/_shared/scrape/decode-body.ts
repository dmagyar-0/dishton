// Charset-aware HTML body decoder. import-url used to decode every fetched
// page as UTF-8 unconditionally, which mojibakes ISO-8859-x / Windows-1250
// pages (common on older European recipe blogs). We pick the charset from the
// Content-Type header, falling back to a sniff of the leading bytes for a
// <meta charset> / XML declaration, then default to UTF-8.
//
// TextDecoder supports the WHATWG encoding labels (utf-8, iso-8859-1,
// windows-1250, ...) natively in Deno, so we only need to extract the label.

const META_CHARSET = /<meta[^>]+charset=["']?\s*([a-z0-9_\-:]+)/i;
const XML_ENCODING = /<\?xml[^>]+encoding=["']\s*([a-z0-9_\-:]+)/i;

// Extract a charset token from a Content-Type header value, if present.
export function charsetFromContentType(contentType: string | null): string | null {
  if (!contentType) return null;
  const m = /charset=["']?\s*([a-z0-9_\-:]+)/i.exec(contentType);
  return m?.[1]?.toLowerCase() ?? null;
}

// Sniff a charset from the first ~2 KB of the body, decoded loosely as Latin-1
// (every byte maps to a code point, so the ASCII <meta>/<?xml ?> markers stay
// intact regardless of the true encoding).
function sniffCharset(bytes: Uint8Array): string | null {
  const head = new TextDecoder('iso-8859-1').decode(bytes.subarray(0, 2048));
  const meta = META_CHARSET.exec(head)?.[1] ?? XML_ENCODING.exec(head)?.[1];
  return meta?.toLowerCase() ?? null;
}

// Decode an HTML body to a string using, in order: the Content-Type charset,
// a sniffed <meta charset>/XML encoding, then UTF-8. An unknown/unsupported
// label falls back to UTF-8 rather than throwing.
export function decodeHtmlBody(bytes: Uint8Array, contentType: string | null): string {
  const label = charsetFromContentType(contentType) ?? sniffCharset(bytes) ?? 'utf-8';
  try {
    // fatal:false (default) substitutes U+FFFD on bad bytes rather than throwing.
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}
