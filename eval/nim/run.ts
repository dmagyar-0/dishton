// Orchestrator. Loads config + URLs, fetches each URL once, fans out to every
// candidate model with bounded concurrency, writes Markdown report.

import { config as defaultConfig, type EvalConfig } from './models.ts';
import { fetchAndExtract, FetchError } from './fetch.ts';
import { callNim, NimError } from './client.ts';
import { callAnthropic, AnthropicError } from './anthropic.ts';
import {
  type ModelOutcome,
  renderConsole,
  type RunResults,
  type UrlBundle,
  writeMarkdown,
} from './report.ts';
import { structuringFromHtml } from '../../supabase/functions/_shared/ai/prompts.ts';
import type { ScrapedRecipe } from '../../supabase/functions/_shared/scrape/recipe-jsonld.ts';
import { Recipe } from '../../src/domain/recipe.ts';

type CliArgs = {
  urlsFile: string;
  repeat: number;
  concurrency: number;
  out: string | null;
  dryRun: boolean;
};

function parsePositiveInt(flag: string, raw: string | undefined): number {
  if (raw === undefined) {
    throw new Error(`${flag} requires a positive integer argument`);
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${flag} requires a positive integer (got "${raw}")`);
  }
  return n;
}

function parseArgs(argv: string[]): CliArgs {
  let urlsFile: string | null = null;
  let repeat: number | null = null;
  let concurrency: number | null = null;
  let out: string | null = null;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--repeat') {
      repeat = parsePositiveInt('--repeat', argv[++i]);
    } else if (a === '--concurrency') {
      concurrency = parsePositiveInt('--concurrency', argv[++i]);
    } else if (a === '--out') {
      out = argv[++i] ?? null;
    } else if (a === '--dry-run') {
      dryRun = true;
    } else if (a.startsWith('--')) {
      throw new Error(`unknown flag: ${a}`);
    } else {
      if (urlsFile === null) urlsFile = a;
      else throw new Error(`unexpected positional arg: ${a}`);
    }
  }
  if (urlsFile === null) {
    throw new Error('usage: run.ts <urls-file> [--repeat N] [--concurrency N] [--out PATH] [--dry-run]');
  }
  return {
    urlsFile,
    repeat: repeat ?? 0,        // 0 means "use config default"
    concurrency: concurrency ?? 0,
    out,
    dryRun,
  };
}

function applyOverrides(base: EvalConfig, args: CliArgs): EvalConfig {
  return {
    ...base,
    repeat: args.repeat > 0 ? args.repeat : base.repeat,
    concurrency: args.concurrency > 0 ? args.concurrency : base.concurrency,
  };
}

async function readUrlList(path: string): Promise<string[]> {
  const text = await Deno.readTextFile(path);
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    out.push(line);
  }
  return out;
}

function defaultOutPath(now: Date): string {
  const iso = now.toISOString().replace(/[:.]/g, '_');
  return `eval/nim/runs/${iso}.md`;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 === 0 ? (s[n / 2 - 1]! + s[n / 2]!) / 2 : s[(n - 1) / 2]!;
}

function validateRaw(raw: string): { schemaOk: true } | { schemaOk: false; error: string } {
  let parsed: unknown;
  try {
    const cleaned = raw.trim().replace(/^```json\s*/, '').replace(/\s*```$/, '');
    parsed = JSON.parse(cleaned);
  } catch (e) {
    return { schemaOk: false, error: `parse: ${(e as Error).message.slice(0, 80)}` };
  }
  const safe = Recipe.safeParse(parsed);
  if (!safe.success) {
    const issue = safe.error.issues[0];
    const path = issue?.path.join('.') ?? '';
    return { schemaOk: false, error: `schema: ${path}` };
  }
  return { schemaOk: true };
}

async function callOnce(args: {
  apiKeys: { nim?: string; anthropic?: string };
  model: { id: string; label?: string; provider: 'nim' | 'anthropic'; temperature?: number; maxTokens?: number };
  url: string;
  cleanedText: string;
  scraped: ScrapedRecipe | null;
  timeoutMs: number;
}): Promise<{
  raw: string;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  schemaOk: boolean;
  error?: string;
}> {
  try {
    const messages = structuringFromHtml({
      html: args.cleanedText,
      sourceUrl: args.url,
      scraped: args.scraped,
    });
    const r = args.model.provider === 'anthropic'
      ? await callAnthropic({
          apiKey: args.apiKeys.anthropic!,
          model: args.model.id,
          messages,
          temperature: args.model.temperature,
          maxTokens: args.model.maxTokens,
          timeoutMs: args.timeoutMs,
        })
      : await callNim({
          apiKey: args.apiKeys.nim!,
          model: args.model.id,
          messages,
          temperature: args.model.temperature,
          maxTokens: args.model.maxTokens,
          timeoutMs: args.timeoutMs,
        });
    const v = validateRaw(r.raw);
    if (v.schemaOk) {
      return {
        raw: r.raw,
        latencyMs: r.latencyMs,
        tokensIn: r.usage.input,
        tokensOut: r.usage.output,
        schemaOk: true,
      };
    }
    return {
      raw: r.raw,
      latencyMs: r.latencyMs,
      tokensIn: r.usage.input,
      tokensOut: r.usage.output,
      schemaOk: false,
      error: v.error,
    };
  } catch (err) {
    if (err instanceof NimError || err instanceof AnthropicError) {
      const errLabel = err.kind === 'http'
        ? `http_${err.status ?? 'unknown'}`
        : err.kind;
      // Timeout calls actually ran for the full timeoutMs; reporting 0 would
      // make timing-out models look artificially fast in the latency columns.
      const latencyMs = err.kind === 'timeout' ? args.timeoutMs : 0;
      return {
        raw: err.body ?? '',
        latencyMs,
        tokensIn: 0,
        tokensOut: 0,
        schemaOk: false,
        error: errLabel,
      };
    }
    throw err;
  }
}

async function evaluateUrl(args: {
  apiKeys: { nim?: string; anthropic?: string };
  model: { id: string; label?: string; provider: 'nim' | 'anthropic'; temperature?: number; maxTokens?: number };
  url: string;
  cleanedText: string;
  scraped: ScrapedRecipe | null;
  timeoutMs: number;
  repeat: number;
}): Promise<ModelOutcome> {
  const calls: {
    raw: string;
    latencyMs: number;
    tokensIn: number;
    tokensOut: number;
    schemaOk: boolean;
    error?: string;
  }[] = [];
  for (let i = 0; i < args.repeat; i++) {
    calls.push(await callOnce({
      apiKeys: args.apiKeys,
      model: args.model,
      url: args.url,
      cleanedText: args.cleanedText,
      scraped: args.scraped,
      timeoutMs: args.timeoutMs,
    }));
  }
  const allOk = calls.every((c) => c.schemaOk);
  const latencies = calls.map((c) => c.latencyMs);
  const last = calls[calls.length - 1]!;
  return {
    url: args.url,
    model: args.model.id,
    modelLabel: args.model.label,
    schemaOk: allOk,
    latencyMs: median(latencies),
    tokensIn: Math.round(calls.reduce((n, c) => n + c.tokensIn, 0) / calls.length),
    tokensOut: Math.round(calls.reduce((n, c) => n + c.tokensOut, 0) / calls.length),
    raw: last.raw,
    error: allOk ? undefined : (calls.find((c) => !c.schemaOk)?.error ?? 'unknown'),
    repeatLatenciesMs: args.repeat > 1 ? latencies : undefined,
  };
}

async function withConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.max(1, Math.min(limit, items.length)); i++) {
    workers.push((async () => {
      while (true) {
        const idx = next++;
        if (idx >= items.length) return;
        results[idx] = await fn(items[idx]!);
      }
    })());
  }
  await Promise.all(workers);
  return results;
}

async function main(): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(Deno.args);
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    return 2;
  }

  // We'll read URL list and config first, then validate env keys based on
  // which providers the candidate list actually uses.

  let urls: string[];
  try {
    urls = await readUrlList(args.urlsFile);
  } catch (e) {
    console.error(`error: cannot read urls file ${args.urlsFile}: ${(e as Error).message}`);
    return 2;
  }
  if (urls.length === 0) {
    console.error(`error: no URLs in ${args.urlsFile}`);
    return 2;
  }

  const cfg = applyOverrides(defaultConfig, args);

  const usesNim = cfg.candidates.some((c) => c.provider === 'nim');
  const usesAnthropic = cfg.candidates.some((c) => c.provider === 'anthropic');
  const apiKeys: { nim?: string; anthropic?: string } = {};
  if (usesNim) {
    const k = Deno.env.get('NVIDIA_API_KEY');
    if (!k) {
      console.error('error: NVIDIA_API_KEY is not set (required by at least one candidate)');
      return 2;
    }
    apiKeys.nim = k;
  }
  if (usesAnthropic) {
    const k = Deno.env.get('ANTHROPIC_API_KEY');
    if (!k) {
      console.error('error: ANTHROPIC_API_KEY is not set (required by at least one candidate)');
      return 2;
    }
    apiKeys.anthropic = k;
  }

  if (args.dryRun) {
    console.log('dry-run OK');
    console.log(`models:      ${cfg.candidates.map((c) => c.label ?? c.id).join(', ')}`);
    console.log(`urls:        ${urls.length}`);
    console.log(`concurrency: ${cfg.concurrency}`);
    console.log(`repeat:      ${cfg.repeat}`);
    return 0;
  }

  const startedAt = new Date();

  // Phase 1: fetch all URLs once
  const fetched: {
    url: string;
    text: string;
    scraped: ScrapedRecipe | null;
  }[] = [];
  const skipped: { url: string; reason: string }[] = [];
  for (const url of urls) {
    try {
      const r = await fetchAndExtract(url);
      fetched.push({ url, text: r.text, scraped: r.scraped });
      console.error(
        `fetched: ${url} (${r.bytes} bytes, jsonld=${r.scraped !== null})`,
      );
    } catch (e) {
      const reason = e instanceof FetchError ? e.reason : 'network';
      skipped.push({ url, reason });
      console.error(`skipped: ${url} — ${reason}`);
    }
  }

  // Phase 2: per model (sequential), per URL (concurrent within model)
  const bundles: UrlBundle[] = fetched.map((f) => ({
    url: f.url,
    sourceExcerpt: f.text.slice(0, 2000),
    jsonldFound: f.scraped !== null,
    outcomes: [],
  }));
  const indexByUrl = new Map(bundles.map((b, i) => [b.url, i]));

  for (const cand of cfg.candidates) {
    console.error(`evaluating model: ${cand.label ?? cand.id}`);
    const outcomes = await withConcurrency(fetched, cfg.concurrency, async (f) => {
      const o = await evaluateUrl({
        apiKeys,
        model: cand,
        url: f.url,
        cleanedText: f.text,
        scraped: f.scraped,
        timeoutMs: cfg.timeoutMs,
        repeat: cfg.repeat,
      });
      console.error(
        `  ${f.url} → schema_ok=${o.schemaOk} latency=${o.latencyMs}ms${o.error ? ` error=${o.error}` : ''}`,
      );
      return o;
    });
    for (const o of outcomes) {
      const idx = indexByUrl.get(o.url)!;
      bundles[idx]!.outcomes.push(o);
    }
  }

  const finishedAt = new Date();
  const results: RunResults = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    config: {
      models: cfg.candidates.map((c) => ({ id: c.id, label: c.label })),
      concurrency: cfg.concurrency,
      repeat: cfg.repeat,
      timeoutMs: cfg.timeoutMs,
    },
    urls: bundles,
    skippedUrls: skipped,
  };

  const outPath = args.out ?? defaultOutPath(startedAt);
  try {
    await writeMarkdown(results, outPath);
  } catch (e) {
    console.error(`error: cannot write report to ${outPath}: ${(e as Error).message}`);
    return 2;
  }

  renderConsole(results);
  console.log('');
  console.log(`Wrote: ${outPath}`);
  console.log(`Next:  in Claude Code, ask "judge the latest run" to fill the placeholders.`);
  return 0;
}

if (import.meta.main) {
  Deno.exit(await main());
}
