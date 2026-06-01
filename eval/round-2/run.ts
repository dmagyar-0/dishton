// Round-2 orchestrator. Builds each case's prompt once, then runs every
// candidate (concurrently within a case) `repeat` times, validating against the
// Recipe schema, computing cost, and diffing gold where present.
//
// Matches production: forced `extract_recipe` tool use for non-thinking
// configs; thinking configs use tool_choice:auto (forcing a specific tool is
// incompatible with thinking) and still call the tool by instruction.
//
// Usage:
//   pnpm eval:round2 [--stage 1,2,3] [--models haiku,opus] [--case <id>]
//                    [--repeat N] [--concurrency N] [--timeout MS]
//                    [--out PATH] [--label TEXT] [--dry-run] [--smoke]

import type { AiMessage } from '../../supabase/functions/_shared/ai/client.ts';
import { type Candidate, CANDIDATES, RUN_DEFAULTS } from './models.ts';
import { type EvalCase, loadCases } from './cases.ts';
import { type AnthropicUsage, callAnthropic, AnthropicError } from './anthropic.ts';
import { costUsd } from './cost.ts';
import {
  type Gold,
  type GoldDiff,
  goldDiff,
  loadGold,
  type RecipeData,
  validateSchema,
} from './score.ts';
import {
  type CaseModelOutcome,
  type CaseRecord,
  renderConsole,
  type RunResults,
  writeMarkdown,
} from './report.ts';
import { EXTRACT_RECIPE_TOOL } from '../../supabase/functions/_shared/ai/tool-schema.ts';

const TOOLS = [EXTRACT_RECIPE_TOOL as unknown as Record<string, unknown>];

type CliArgs = {
  stages: number[] | null;
  models: string[] | null;
  caseId: string | null;
  repeat: number;
  concurrency: number;
  timeoutMs: number;
  out: string | null;
  label: string;
  dryRun: boolean;
  smoke: boolean;
};

function parseIntArg(flag: string, raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${flag} needs a positive integer`);
  return n;
}

function parseArgs(argv: string[]): CliArgs {
  const a: CliArgs = {
    stages: null,
    models: null,
    caseId: null,
    repeat: RUN_DEFAULTS.repeat,
    concurrency: RUN_DEFAULTS.concurrency,
    timeoutMs: RUN_DEFAULTS.timeoutMs,
    out: null,
    label: 'round-2 R2.0',
    dryRun: false,
    smoke: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i]!;
    if (f === '--stage') a.stages = (argv[++i] ?? '').split(',').map((s) => Number(s.trim()));
    else if (f === '--models') a.models = (argv[++i] ?? '').split(',').map((s) => s.trim());
    else if (f === '--case') a.caseId = argv[++i] ?? null;
    else if (f === '--repeat') a.repeat = parseIntArg('--repeat', argv[++i]);
    else if (f === '--concurrency') a.concurrency = parseIntArg('--concurrency', argv[++i]);
    else if (f === '--timeout') a.timeoutMs = parseIntArg('--timeout', argv[++i]);
    else if (f === '--out') a.out = argv[++i] ?? null;
    else if (f === '--label') a.label = argv[++i] ?? a.label;
    else if (f === '--dry-run') a.dryRun = true;
    else if (f === '--smoke') a.smoke = true;
    else throw new Error(`unknown flag: ${f}`);
  }
  return a;
}

// Deno's --env-file has been flaky on this checkout (CRLF .env → key not
// populated), so fall back to parsing .env ourselves when the key isn't already
// in the environment. Needs --allow-read (already granted).
async function ensureApiKey(): Promise<string | null> {
  const fromEnv = Deno.env.get('ANTHROPIC_API_KEY');
  if (fromEnv) return fromEnv;
  try {
    const text = await Deno.readTextFile('.env');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?ANTHROPIC_API_KEY\s*=\s*(.*)$/);
      if (m) {
        const key = m[1]!.trim().replace(/^["']|["']$/g, '');
        if (key) return key;
      }
    }
  } catch {
    // no .env — fall through
  }
  return null;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
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

type SingleCall = {
  raw: string;
  schemaOk: boolean;
  error?: string;
  latencyMs: number;
  usage: AnthropicUsage;
  costUsd: number | null;
  usedTool: boolean;
  stopReason: string | null;
  recipe?: RecipeData;
};

async function oneCall(
  apiKey: string,
  cand: Candidate,
  messages: AiMessage[],
  timeoutMs: number,
): Promise<SingleCall> {
  // Forcing a named tool is incompatible with thinking; thinking configs use
  // auto and rely on the prompt instruction to call extract_recipe.
  const toolChoice: Record<string, unknown> = cand.thinking
    ? { type: 'auto' }
    : { type: 'tool', name: 'extract_recipe' };
  let lastErr: AnthropicError | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await callAnthropic({
        apiKey,
        model: cand.model,
        messages,
        maxTokens: cand.maxTokens,
        timeoutMs,
        tools: TOOLS,
        toolChoice,
        thinking: cand.thinking,
        effort: cand.effort,
      });
      const v = validateSchema(r.raw);
      return {
        raw: r.raw,
        schemaOk: v.ok,
        error: v.ok ? undefined : v.error,
        latencyMs: r.latencyMs,
        usage: r.usage,
        costUsd: costUsd(cand.model, r.usage),
        usedTool: r.usedTool,
        stopReason: r.stopReason,
        recipe: v.ok ? v.recipe : undefined,
      };
    } catch (err) {
      if (!(err instanceof AnthropicError)) throw err;
      lastErr = err;
      // Retry only transient rate-limit / overload — not content or credit errors.
      const transient = err.kind === 'http' && (err.status === 429 || err.status === 529);
      if (transient && attempt < 2) {
        await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
        continue;
      }
      break;
    }
  }
  const err = lastErr!;
  const isCredit = err.kind === 'http' && err.status === 400 &&
    (err.body ?? '').includes('credit balance is too low');
  const label = isCredit
    ? 'credit_exhausted'
    : err.kind === 'http'
    ? `http_${err.status ?? '?'}`
    : err.kind;
  return {
    raw: err.body ?? '',
    schemaOk: false,
    error: label,
    latencyMs: err.kind === 'timeout' ? timeoutMs : 0,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    costUsd: null,
    usedTool: false,
    stopReason: null,
  };
}

async function evalCandidate(
  apiKey: string,
  cand: Candidate,
  ec: EvalCase,
  messages: AiMessage[],
  gold: Gold | null,
  repeat: number,
  timeoutMs: number,
): Promise<CaseModelOutcome> {
  const calls: SingleCall[] = [];
  for (let i = 0; i < repeat; i++) {
    calls.push(await oneCall(apiKey, cand, messages, timeoutMs));
  }
  const last = calls[calls.length - 1]!;
  const costs = calls.map((c) => c.costUsd).filter((n): n is number => n !== null);
  // gold diff on the last successful parse (or any)
  let gd: GoldDiff | undefined;
  if (gold) {
    const recipe = [...calls].reverse().find((c) => c.recipe)?.recipe;
    if (recipe) gd = goldDiff(recipe, gold);
  }
  return {
    caseId: ec.id,
    stage: ec.stage,
    kind: ec.kind,
    caseLabel: ec.label,
    modelLabel: cand.label,
    model: cand.model,
    schemaOk: calls.every((c) => c.schemaOk),
    error: calls.find((c) => !c.schemaOk)?.error,
    latencyMs: Math.round(median(calls.map((c) => c.latencyMs))),
    latencies: calls.map((c) => c.latencyMs),
    avgCostUsd: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null,
    avgTokensIn: Math.round(calls.reduce((n, c) => n + c.usage.input, 0) / calls.length),
    avgTokensOut: Math.round(calls.reduce((n, c) => n + c.usage.output, 0) / calls.length),
    usedTool: last.usedTool,
    stopReason: last.stopReason,
    raw: last.raw,
    gold: gd,
  };
}

function selectCases(all: EvalCase[], args: CliArgs): EvalCase[] {
  let sel = all;
  if (args.stages) sel = sel.filter((c) => args.stages!.includes(c.stage));
  if (args.caseId) sel = sel.filter((c) => c.id === args.caseId);
  if (args.smoke) {
    const cheap = sel.find((c) => c.kind === 'caption') ?? sel[0];
    sel = cheap ? [cheap] : [];
  }
  return sel;
}

function selectCandidates(args: CliArgs): Candidate[] {
  if (args.smoke) return CANDIDATES.filter((c) => c.label === 'haiku');
  if (args.models) return CANDIDATES.filter((c) => args.models!.includes(c.label));
  return CANDIDATES;
}

async function main(): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(Deno.args);
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    return 2;
  }
  if (args.smoke) args.repeat = 1;

  const allCases = await loadCases();
  const cases = selectCases(allCases, args);
  const candidates = selectCandidates(args);
  if (cases.length === 0) {
    console.error('error: no cases selected');
    return 2;
  }
  if (candidates.length === 0) {
    console.error('error: no candidates selected');
    return 2;
  }

  if (args.dryRun) {
    console.log('dry-run — no API calls');
    console.log(`label:       ${args.label}`);
    console.log(`candidates:  ${candidates.map((c) => c.label).join(', ')}`);
    for (const c of candidates) {
      const tc = c.thinking ? 'auto' : 'force extract_recipe';
      console.log(
        `  - ${c.label}: model=${c.model} thinking=${c.thinking ?? 'off'} effort=${c.effort ?? '-'} tool_choice=${tc}`,
      );
    }
    console.log(`cases:       ${cases.length}`);
    for (const c of cases) console.log(`  - [s${c.stage}] ${c.id} (${c.kind}) ${c.label}`);
    console.log(`repeat:      ${args.repeat}`);
    console.log(`total calls: ${cases.length * candidates.length * args.repeat}`);
    return 0;
  }

  const apiKey = await ensureApiKey();
  if (!apiKey) {
    console.error('error: ANTHROPIC_API_KEY is not set (checked env and .env)');
    return 2;
  }

  const startedAt = new Date();
  const records: CaseRecord[] = [];

  for (const ec of cases) {
    console.error(`\ncase ${ec.id} (s${ec.stage}, ${ec.kind})`);
    let built;
    try {
      built = await ec.build();
    } catch (e) {
      console.error(`  skipped: ${(e as Error).message}`);
      records.push({
        id: ec.id,
        stage: ec.stage,
        kind: ec.kind,
        label: ec.label,
        built: false,
        skipReason: (e as Error).message.slice(0, 120),
        sourceExcerpt: '',
        outcomes: [],
      });
      continue;
    }
    const gold = ec.goldPath ? await loadGold(ec.goldPath) : null;

    const outcomes = await withConcurrency(candidates, args.concurrency, async (cand) => {
      const o = await evalCandidate(
        apiKey,
        cand,
        ec,
        built!.messages,
        gold,
        args.repeat,
        args.timeoutMs,
      );
      console.error(
        `  ${cand.label.padEnd(13)} schema_ok=${o.schemaOk} latency=${o.latencyMs}ms cost=${o.avgCostUsd === null ? '-' : `$${o.avgCostUsd.toFixed(4)}`}${o.gold ? ` recall=${Math.round(o.gold.recall * 100)}% bleed=${o.gold.bleed.length}` : ''}${o.error ? ` err=${o.error}` : ''}`,
      );
      return o;
    });

    records.push({
      id: ec.id,
      stage: ec.stage,
      kind: ec.kind,
      label: ec.label,
      built: true,
      sourceExcerpt: built.sourceExcerpt,
      outcomes,
    });

    if (outcomes.some((o) => o.error === 'credit_exhausted')) {
      console.error(
        '\nABORTING: Anthropic API credit exhausted ("credit balance is too low"). Top up and re-run — a partial report has been written.',
      );
      break;
    }
  }

  const finishedAt = new Date();
  const results: RunResults = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    config: {
      models: candidates.map((c) => c.label),
      repeat: args.repeat,
      concurrency: args.concurrency,
      timeoutMs: args.timeoutMs,
      round: args.label,
    },
    cases: records,
  };

  const slug = args.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const iso = startedAt.toISOString().replace(/[:.]/g, '_');
  const outPath = args.out ?? `eval/round-2/runs/${slug}-${iso}.md`;
  await Deno.mkdir('eval/round-2/runs', { recursive: true });
  await writeMarkdown(results, outPath);

  console.log('');
  renderConsole(results);
  console.log('');
  console.log(`Wrote: ${outPath}`);
  console.log('Next: review the report, then run the interactive LLM-judge pass to fill TBD scores.');
  return 0;
}

if (import.meta.main) {
  Deno.exit(await main());
}
