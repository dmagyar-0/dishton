// URL fetch + Readability extract. Mirrors the byte cap, timeout, UA, and
// fallback behavior of supabase/functions/import-url/index.ts so the eval
// feeds models the same input production does.

import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

const MAX_BYTES = 5_000_000;
const FETCH_TIMEOUT_MS = 15_000;
const USER_AGENT = 'DishtonBot/0.1 (+https://dishton.app)';

export type ExtractResult = {
  text: string;
  bytes: number;
  readabilityUsed: boolean;
};

export class FetchError extends Error {
  constructor(
    public reason:
      | 'fetch_failed'
      | 'not_html'
      | 'empty_body'
      | 'too_large'
      | 'timeout'
      | 'network',
    public detail?: unknown,
  ) {
    super(`fetch ${reason}`);
  }
}

export async function fetchAndExtract(
  url: string,
  signal?: AbortSignal,
): Promise<ExtractResult> {
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'user-agent': USER_AGENT },
      signal: ac.signal,
    }).catch((err) => {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new FetchError('timeout');
      }
      throw new FetchError('network', String((err as Error).message ?? err));
    });
    if (!res.ok) throw new FetchError('fetch_failed', { status: res.status });
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('text/html')) throw new FetchError('not_html');
    const reader = res.body?.getReader();
    if (!reader) throw new FetchError('empty_body');
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        total += value.length;
        if (total > MAX_BYTES) throw new FetchError('too_large');
        chunks.push(value);
      }
    }
    const html = new TextDecoder('utf-8').decode(concat(chunks));
    return extractFromHtml(html, total);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export function extractFromHtml(html: string, bytes: number): ExtractResult {
  const dom = parseHTML(html);
  const reader = new Readability((dom as any).document);
  const article = reader.parse();
  const text = article?.textContent?.trim() ?? '';
  if (text.length > 0) {
    return { text, bytes, readabilityUsed: true };
  }
  return { text: html, bytes, readabilityUsed: false };
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const len = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(len);
  let i = 0;
  for (const c of chunks) {
    out.set(c, i);
    i += c.length;
  }
  return out;
}
