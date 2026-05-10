// Caption-mode eval. Mirrors run.ts but feeds a literal caption (read from
// disk) through structuringFromCaption — the same prompt the import-instagram
// edge function uses on the no-key fallback path. Use this when an Instagram
// import returns needs_review=true with reason=schema, to see whether the
// problem is the caption shape or a specific candidate model.
//
// The caption is sent verbatim. Production only strips HTML tags from the
// og:description before concatenating it with og:title; if you saved the
// caption from a screenshot or copy-paste, no further cleaning is performed.
//
// Usage:
//   pnpm caption:eval --caption-file <path> [--source-url <url>] [--repeat N]
//                     [--out PATH] [--dry-run] [--print-prompt]
//
// Examples:
//   pnpm caption:eval --caption-file eval/nim/captions/zingy-lime-cheesecake.txt
//   pnpm caption:eval --caption-file ... --source-url https://www.instagram.com/reel/abc/

import { config as defaultConfig, type EvalConfig } from './models.ts';
import { callNim, NimError } from './client.ts';
import { callAnthropic, AnthropicError } from './anthropic.ts';
import {
  type ModelOutcome,
  renderConsole,
  type RunResults,
  type UrlBundle,
  writeMarkdown,
} from './report.ts';
import { structuringFromCaption } from '../../supabase/functions/_shared/ai/prompts.ts';
import { Recipe } from '../../src/domain/recipe.ts';

type CliArgs = {
  captionFile: string;
  sourceUrl: string;
  repeat: number;
  concurrency: number;
  out: string | null;
  dryRun: boolean;
  printPrompt: boolean;
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
  let captionFile: string | null = null;
  let sourceUrl = 'https://www.instagram.com/reel/UNKNOWN/';
  let repeat: number | null = null;
  let concurrency: number | null = null;
  let out: string | null = null;
  let dryRun = false;
  let printPrompt = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--caption-file') {
      captionFile = argv[++i] ?? null;
    } else if (a === '--source-url') {
      sourceUrl = argv[++i] ?? sourceUrl;
    } else if (a === '--repeat') {
      repeat = parsePositiveInt('--repeat', argv[++i]);
    } else if (a === '--concurrency') {
      concurrency = parsePositiveInt('--concurrency', argv[++i]);
    } else if (a === '--out') {
      out = argv[++i] ?? null;
    } else if (a === '--dry-run') {
      dryRun = true;
    } else if (a === '--print-prompt') {
      printPrompt = true;
    } else if (a.startsWith('--')) {
      throw new Error(`unknown flag: ${a}`);
    } else {
      throw new Error(`unexpected positional arg: ${a}`);
    }
  }
  if (captionFile === null) {
    throw new Error(
      'usage: caption.ts --caption-file <path> [--source-url <url>] [--repeat N] [--concurrency N] [--out PATH] [--dry-run] [--print-prompt]',
    );
  }
  return {
    captionFile,
    sourceUrl,
    repeat: repeat ?? 0,
    concurrency: concurrency ?? 0,
    out,
    dryRun,
    printPrompt,
  };
}

function applyOverrides(base: EvalConfig, args: CliArgs): EvalConfig {
  return {
    ...base,
    repeat: args.repeat > 0 ? args.repeat : base.repeat,
    concurrency: args.concurrency > 0 ? args.concurrency : base.concurrency,
  };
}

function defaultOutPath(now: Date, captionFile: string): string {
  const iso = now.toISOString().replace(/[:.]/g, '_');
  const slug = captionFile.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'caption';
  return `eval/nim/runs/caption-${slug}-${iso}.md`;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 === 0 ? (s[n / 2 - 1]! + s[n / 2]!) / 2 : s[(n - 1) / 2]!;
}

function validateRaw(
  raw: string,
): { schemaOk: true } | { schemaOk: false; error: string } {
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
    const code = issue?.code ?? 'unknown';
    return { schemaOk: false, error: `schema: ${path} (${code})` };
  }
  return { schemaOk: true };
}

async function callOnce(args: {
  apiKeys: { nim?: string; anthropic?: string };
  model: { id: string; label?: string; provider: 'nim' | 'anthropic'; temperature?: number; maxTokens?: number };
  caption: string;
  sourceUrl: string;
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
    const messages = structuringFromCaption({
      caption: args.caption,
      sourceUrl: args.sourceUrl,
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
    return {
      raw: r.raw,
      latencyMs: r.latencyMs,
      tokensIn: r.usage.input,
      tokensOut: r.usage.output,
      schemaOk: v.schemaOk,
      error: v.schemaOk ? undefined : v.error,
    };
  } catch (err) {
    if (err instanceof NimError || err instanceof AnthropicError) {
      const errLabel = err.kind === 'http'
        ? `http_${err.status ?? 'unknown'}`
        : err.kind;
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

async function evaluateCandidate(args: {
  apiKeys: { nim?: string; anthropic?: string };
  model: { id: string; label?: string; provider: 'nim' | 'anthropic'; temperature?: number; maxTokens?: number };
  caption: string;
  sourceUrl: string;
  timeoutMs: number;
  repeat: number;
}): Promise<ModelOutcome> {
  const calls: Awaited<ReturnType<typeof callOnce>>[] = [];
  for (let i = 0; i < args.repeat; i++) {
    calls.push(await callOnce({
      apiKeys: args.apiKeys,
      model: args.model,
      caption: args.caption,
      sourceUrl: args.sourceUrl,
      timeoutMs: args.timeoutMs,
    }));
  }
  const allOk = calls.every((c) => c.schemaOk);
  const latencies = calls.map((c) => c.latencyMs);
  const last = calls[calls.length - 1]!;
  return {
    url: args.sourceUrl,
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

  let caption: string;
  try {
    caption = await Deno.readTextFile(args.captionFile);
  } catch (e) {
    console.error(`error: cannot read caption file ${args.captionFile}: ${(e as Error).message}`);
    return 2;
  }
  if (caption.trim().length === 0) {
    console.error(`error: caption file ${args.captionFile} is empty`);
    return 2;
  }

  if (args.printPrompt) {
    const messages = structuringFromCaption({ caption, sourceUrl: args.sourceUrl });
    const bar = '─'.repeat(72);
    console.log(bar);
    console.log(`Caption file       : ${args.captionFile}`);
    console.log(`Caption length     : ${caption.length} chars`);
    console.log(`Source URL         : ${args.sourceUrl}`);
    console.log(bar);
    console.log('SYSTEM MESSAGE');
    console.log(bar);
    console.log(messages[0]!.content);
    console.log(bar);
    console.log('USER MESSAGE');
    console.log(bar);
    console.log(messages[1]!.content);
    console.log(bar);
    return 0;
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
    console.log(`models:        ${cfg.candidates.map((c) => c.label ?? c.id).join(', ')}`);
    console.log(`caption_file:  ${args.captionFile} (${caption.length} chars)`);
    console.log(`source_url:    ${args.sourceUrl}`);
    console.log(`concurrency:   ${cfg.concurrency}`);
    console.log(`repeat:        ${cfg.repeat}`);
    return 0;
  }

  const startedAt = new Date();

  const bundle: UrlBundle = {
    url: args.sourceUrl,
    sourceExcerpt: caption.slice(0, 2000),
    jsonldFound: false,
    outcomes: [],
  };

  for (const cand of cfg.candidates) {
    console.error(`evaluating model: ${cand.label ?? cand.id}`);
    const o = await evaluateCandidate({
      apiKeys,
      model: cand,
      caption,
      sourceUrl: args.sourceUrl,
      timeoutMs: cfg.timeoutMs,
      repeat: cfg.repeat,
    });
    console.error(
      `  schema_ok=${o.schemaOk} latency=${o.latencyMs}ms${o.error ? ` error=${o.error}` : ''}`,
    );
    bundle.outcomes.push(o);
  }

  // withConcurrency reserved for future multi-caption batching; single caption
  // here runs models sequentially so the console log is readable.
  void withConcurrency;

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
    urls: [bundle],
    skippedUrls: [],
  };

  const outPath = args.out ?? defaultOutPath(startedAt, args.captionFile);
  try {
    await writeMarkdown(results, outPath);
  } catch (e) {
    console.error(`error: cannot write report to ${outPath}: ${(e as Error).message}`);
    return 2;
  }

  renderConsole(results);
  console.log('');
  console.log(`Wrote: ${outPath}`);
  return 0;
}

if (import.meta.main) {
  Deno.exit(await main());
}
