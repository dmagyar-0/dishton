// URL fetch + lightStripHtml extract. Mirrors the byte cap, timeout, UA, and
// stripping behavior of supabase/functions/import-url/index.ts so the eval
// feeds models the same input production does. Imports the production
// strip-html and recipe-jsonld utilities directly to avoid drift.

import { parseHTML } from 'linkedom';
import { lightStripHtml } from '../../supabase/functions/_shared/scrape/strip-html.ts';
import {
  extractRecipeJsonLd,
  type ScrapedRecipe,
} from '../../supabase/functions/_shared/scrape/recipe-jsonld.ts';

const MAX_BYTES = 5_000_000;
const FETCH_TIMEOUT_MS = 15_000;
const USER_AGENT = 'DishtonBot/0.1 (+https://dishton.app)';

export type ExtractResult = {
  text: string;
  bytes: number;
  scraped: ScrapedRecipe | null;
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
  // Use AbortSignal.any so the per-fetch timeout and the optional caller signal
  // both terminate body streaming.  AbortSignal.timeout() is handled natively
  // by Deno's HTTP client and correctly interrupts reader.read() mid-stream,
  // unlike a manual setTimeout+AbortController which only sets a flag and may
  // not wake a blocked native I/O wait.
  const fetchSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)])
    : AbortSignal.timeout(FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'user-agent': USER_AGENT },
      signal: fetchSignal,
    });
  } catch (err) {
    const isAbort = err instanceof DOMException &&
      (err.name === 'AbortError' || err.name === 'TimeoutError');
    if (isAbort) throw new FetchError('timeout');
    throw new FetchError('network', String((err as Error).message ?? err));
  }

  if (!res.ok) throw new FetchError('fetch_failed', { status: res.status });
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('text/html')) throw new FetchError('not_html');
  const reader = res.body?.getReader();
  if (!reader) throw new FetchError('empty_body');

  // Race each read against the abort signal.  This catches the case where the
  // server streams the response headers immediately but then keeps the TCP
  // connection open without sending a terminating DATA frame (e.g. BBC Food's
  // Next.js streaming SSR when it detects a bot UA).  Without the race,
  // reader.read() blocks indefinitely even after the AbortController fires.
  const abortedPromise = new Promise<never>((_, reject) => {
    if (fetchSignal.aborted) {
      reject(new FetchError('timeout'));
      return;
    }
    fetchSignal.addEventListener('abort', () => reject(new FetchError('timeout')), {
      once: true,
    });
  });

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), abortedPromise]);
      if (done) break;
      if (value) {
        total += value.length;
        if (total > MAX_BYTES) throw new FetchError('too_large');
        chunks.push(value);
      }
    }
  } catch (err) {
    reader.cancel().catch(() => {});
    if (err instanceof FetchError) throw err;
    const isAbort = err instanceof DOMException &&
      (err.name === 'AbortError' || err.name === 'TimeoutError');
    if (isAbort) throw new FetchError('timeout');
    throw new FetchError('network', String((err as Error).message ?? err));
  }

  const html = new TextDecoder('utf-8').decode(concat(chunks));
  return extractFromHtml(html, total);
}

export function extractFromHtml(html: string, bytes: number): ExtractResult {
  // JSON-LD must come from the raw HTML — lightStripHtml drops <script>.
  const dom = parseHTML(html);
  const scraped = extractRecipeJsonLd((dom as any).document);
  const text = lightStripHtml(html);
  return { text, bytes, scraped };
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
