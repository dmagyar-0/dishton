// Console table + Markdown writer. The Markdown report contains TBD
// placeholders that the active Claude Code session fills in interactively.

export type ModelOutcome = {
  url: string;
  model: string;
  modelLabel?: string;
  schemaOk: boolean;
  latencyMs: number | null;
  tokensIn: number;
  tokensOut: number;
  raw: string;
  error?: string;
  repeatLatenciesMs?: number[];
};

export type UrlBundle = {
  url: string;
  sourceExcerpt: string;
  jsonldFound: boolean;
  outcomes: ModelOutcome[];
};

export type RunResults = {
  startedAt: string;
  finishedAt: string;
  config: {
    models: { id: string; label?: string }[];
    concurrency: number;
    repeat: number;
    timeoutMs: number;
  };
  urls: UrlBundle[];
  skippedUrls: { url: string; reason: string }[];
};

export type ModelAggregate = {
  model: string;
  modelLabel?: string;
  schemaOk: string;
  schemaOkPct: number;
  p50Ms: number | null;
  p95Ms: number | null;
  avgTokensIn: number;
  avgTokensOut: number;
  errors: string[];
};

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo]!;
  const frac = rank - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

export function aggregate(results: RunResults): ModelAggregate[] {
  const byModel = new Map<string, ModelOutcome[]>();
  for (const u of results.urls) {
    for (const o of u.outcomes) {
      const arr = byModel.get(o.model) ?? [];
      arr.push(o);
      byModel.set(o.model, arr);
    }
  }
  const out: ModelAggregate[] = [];
  for (const m of results.config.models) {
    const outcomes = byModel.get(m.id) ?? [];
    const okCount = outcomes.filter((o) => o.schemaOk).length;
    const latencies = outcomes
      .map((o) => o.latencyMs)
      .filter((v): v is number => typeof v === 'number');
    const errors = outcomes.filter((o) => !o.schemaOk).map((o) => o.error ?? 'unknown');
    const tokensIn = outcomes.length > 0
      ? Math.round(outcomes.reduce((n, o) => n + o.tokensIn, 0) / outcomes.length)
      : 0;
    const tokensOut = outcomes.length > 0
      ? Math.round(outcomes.reduce((n, o) => n + o.tokensOut, 0) / outcomes.length)
      : 0;
    out.push({
      model: m.id,
      modelLabel: m.label,
      schemaOk: `${okCount}/${outcomes.length}`,
      schemaOkPct: outcomes.length > 0 ? okCount / outcomes.length : 0,
      p50Ms: percentile(latencies, 50),
      p95Ms: percentile(latencies, 95),
      avgTokensIn: tokensIn,
      avgTokensOut: tokensOut,
      errors,
    });
  }
  out.sort((a, b) => {
    if (a.schemaOkPct !== b.schemaOkPct) return b.schemaOkPct - a.schemaOkPct;
    const ap = a.p50Ms ?? Number.POSITIVE_INFINITY;
    const bp = b.p50Ms ?? Number.POSITIVE_INFINITY;
    return ap - bp;
  });
  return out;
}

export function renderConsole(results: RunResults): void {
  const agg = aggregate(results);
  const lines: string[] = [];
  lines.push(`=== NIM Eval — ${results.startedAt} ===`);
  lines.push(`Models: ${results.config.models.map((m) => m.label ?? m.id).join(', ')}`);
  lines.push(`URLs:   ${results.urls.length}`);
  lines.push('');
  const headers = ['Model', 'schema_ok', 'p50_ms', 'p95_ms', 'tokens_in', 'tokens_out', 'errors'];
  const rows = agg.map((r) => [
    r.modelLabel ?? r.model,
    r.schemaOk,
    r.p50Ms === null ? '-' : Math.round(r.p50Ms).toString(),
    r.p95Ms === null ? '-' : Math.round(r.p95Ms).toString(),
    r.avgTokensIn.toString(),
    r.avgTokensOut.toString(),
    r.errors.length === 0 ? '0' : `${r.errors.length} (${dedupe(r.errors).join(', ')})`,
  ]);
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => row[i]!.length))
  );
  const fmt = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i]!)).join('  ');
  lines.push(fmt(headers));
  lines.push(fmt(widths.map((w) => '-'.repeat(w))));
  for (const row of rows) lines.push(fmt(row));
  console.log(lines.join('\n'));
}

function dedupe<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

export async function writeMarkdown(
  results: RunResults,
  outPath: string,
): Promise<void> {
  const agg = aggregate(results);
  const md: string[] = [];
  md.push(`# NIM Eval Run — ${results.startedAt}`);
  md.push('');
  md.push('## Leaderboard');
  md.push('');
  md.push(
    '| Model | schema_ok | latency p50 | overall | completeness | fidelity | format |',
  );
  md.push('|-------|-----------|-------------|---------|--------------|----------|--------|');
  for (const r of agg) {
    const p50 = r.p50Ms === null ? '-' : `${Math.round(r.p50Ms)} ms`;
    md.push(
      `| ${r.modelLabel ?? r.model} | ${r.schemaOk} | ${p50} | TBD | TBD | TBD | TBD |`,
    );
  }
  md.push('');
  md.push('## Run config');
  md.push(`- Started:     ${results.startedAt}`);
  md.push(`- Finished:    ${results.finishedAt}`);
  md.push(`- Models:      ${results.config.models.map((m) => `${m.label ?? m.id}`).join(', ')}`);
  md.push(`- URLs:        ${results.urls.length}`);
  md.push(`- Concurrency: ${results.config.concurrency}`);
  md.push(`- Repeat:      ${results.config.repeat}`);
  md.push(`- Timeout:     ${results.config.timeoutMs} ms`);
  md.push('');
  md.push('## Per-URL results');
  md.push('');
  for (let i = 0; i < results.urls.length; i++) {
    const u = results.urls[i]!;
    md.push(`### URL ${i + 1} — ${u.url}`);
    md.push('');
    md.push(
      `**Source excerpt** (first 2000 chars of stripped HTML${u.jsonldFound ? '; JSON-LD also passed as Hint' : '; no JSON-LD on page'}):`,
    );
    md.push('');
    md.push('```');
    md.push(u.sourceExcerpt);
    md.push('```');
    md.push('');
    for (const o of u.outcomes) {
      md.push(`#### Model: ${o.modelLabel ?? o.model}`);
      md.push(`- schema_ok: ${o.schemaOk}`);
      md.push(`- latency_ms: ${o.latencyMs ?? '-'}`);
      md.push(`- tokens_in: ${o.tokensIn}, tokens_out: ${o.tokensOut}`);
      md.push(`- error: ${o.error ?? '—'}`);
      if (o.repeatLatenciesMs && o.repeatLatenciesMs.length > 1) {
        md.push(`- repeat latencies: ${o.repeatLatenciesMs.join(', ')}`);
      }
      md.push('');
      md.push('**Raw output:**');
      md.push('');
      md.push('```json');
      md.push(o.raw);
      md.push('```');
      md.push('');
      md.push('**Judge:**');
      md.push('- Completeness: TBD');
      md.push('- Fidelity: TBD');
      md.push('- Format hygiene: TBD');
      md.push('- Overall: TBD');
      md.push('- Notes: TBD');
      md.push('');
    }
  }
  if (results.skippedUrls.length > 0) {
    md.push('## Skipped URLs');
    md.push('');
    for (const s of results.skippedUrls) {
      md.push(`- ${s.url} — ${s.reason}`);
    }
    md.push('');
  } else {
    md.push('## Skipped URLs');
    md.push('');
    md.push('_None._');
    md.push('');
  }
  await Deno.writeTextFile(outPath, md.join('\n'));
}
