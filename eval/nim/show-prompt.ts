// Resolve every step that runs before the model call for a generic URL import,
// then print the exact AiMessage[] that production sends to the LLM. Use this
// when iterating on the prompt: change `prompts.ts`, run this, eyeball the
// rendered messages without burning model tokens.
//
// Mirrors supabase/functions/import-url/index.ts: same byte cap, same UA, same
// 15s fetch timeout, same Readability fallback, same JSON-LD extraction. The
// cap on HTML/text length is applied inside structuringFromHtml itself.
//
// Usage:
//   pnpm prompt:show <url> [--json] [--no-jsonld] [--raw-html]
//
// Flags:
//   --json       emit the messages array as JSON (default: pretty)
//   --no-jsonld  skip extractRecipeJsonLd (simulates a page without JSON-LD)
//   --raw-html   skip Readability (feed raw HTML, like production fallback)

import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { structuringFromHtml } from '../../supabase/functions/_shared/ai/prompts.ts';
import { extractRecipeJsonLd } from '../../supabase/functions/_shared/scrape/recipe-jsonld.ts';

const MAX_BYTES = 5_000_000;
const FETCH_TIMEOUT_MS = 15_000;
const USER_AGENT = 'DishtonBot/0.1 (+https://dishton.app)';

type Args = {
  url: string;
  json: boolean;
  skipJsonLd: boolean;
  rawHtml: boolean;
};

function parseArgs(argv: string[]): Args {
  let url: string | null = null;
  let json = false;
  let skipJsonLd = false;
  let rawHtml = false;
  for (const a of argv) {
    if (a === '--json') json = true;
    else if (a === '--no-jsonld') skipJsonLd = true;
    else if (a === '--raw-html') rawHtml = true;
    else if (a.startsWith('--')) throw new Error(`unknown flag: ${a}`);
    else if (url === null) url = a;
    else throw new Error(`unexpected positional arg: ${a}`);
  }
  if (url === null) {
    throw new Error('usage: show-prompt.ts <url> [--json] [--no-jsonld] [--raw-html]');
  }
  return { url, json, skipJsonLd, rawHtml };
}

async function fetchHtml(url: string): Promise<{ html: string; bytes: number }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'user-agent': USER_AGENT },
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`fetch_failed status=${res.status}`);
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('text/html')) throw new Error(`not_html content-type=${ct}`);
    const reader = res.body?.getReader();
    if (!reader) throw new Error('empty_body');
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        total += value.length;
        if (total > MAX_BYTES) throw new Error('source_too_large');
        chunks.push(value);
      }
    }
    return { html: new TextDecoder('utf-8').decode(concat(chunks)), bytes: total };
  } finally {
    clearTimeout(timer);
  }
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

async function main(): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(Deno.args);
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    return 2;
  }

  const t0 = performance.now();
  const { html, bytes } = await fetchHtml(args.url);
  const fetchMs = Math.round(performance.now() - t0);

  const dom = parseHTML(html);
  const scraped = args.skipJsonLd ? null : extractRecipeJsonLd((dom as any).document);

  let text: string;
  let readabilityUsed: boolean;
  if (args.rawHtml) {
    text = html;
    readabilityUsed = false;
  } else {
    const reader = new Readability((dom as any).document);
    const article = reader.parse();
    const parsed = article?.textContent ?? '';
    text = parsed.length > 0 ? parsed : html;
    readabilityUsed = parsed.length > 0;
  }

  const messages = structuringFromHtml({
    html: text,
    sourceUrl: args.url,
    scraped,
  });

  // System messages are content strings, user messages may be string or array.
  const systemContent = messages[0]!.content as string;
  const userContent = messages[1]!.content as string;

  if (args.json) {
    console.log(JSON.stringify({
      url: args.url,
      meta: {
        fetched_bytes: bytes,
        fetch_ms: fetchMs,
        readability_used: readabilityUsed,
        jsonld_found: scraped !== null,
        text_input_chars: text.length,
        prompt_user_chars: userContent.length,
        prompt_system_chars: systemContent.length,
      },
      scraped,
      messages,
    }, null, 2));
    return 0;
  }

  const bar = '─'.repeat(72);
  console.log(bar);
  console.log(`URL                : ${args.url}`);
  console.log(`Fetched            : ${bytes} bytes in ${fetchMs}ms`);
  console.log(`Readability used   : ${readabilityUsed}`);
  console.log(`JSON-LD found      : ${scraped !== null}`);
  console.log(`Text fed to prompt : ${text.length} chars (cap applied inside structuringFromHtml)`);
  console.log(`User message size  : ${userContent.length} chars`);
  console.log(`System message size: ${systemContent.length} chars`);
  if (scraped) {
    console.log(`JSON-LD title      : ${scraped.name ?? '(none)'}`);
    console.log(`JSON-LD ingredients: ${scraped.ingredients.length}`);
    console.log(`JSON-LD steps      : ${scraped.instructions.length}`);
  }
  console.log(bar);
  console.log('SYSTEM MESSAGE');
  console.log(bar);
  console.log(systemContent);
  console.log(bar);
  console.log('USER MESSAGE');
  console.log(bar);
  console.log(userContent);
  console.log(bar);
  return 0;
}

if (import.meta.main) {
  Deno.exit(await main());
}
