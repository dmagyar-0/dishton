// Console summary + Markdown report for round 2. The Markdown carries the
// automated metrics (schema, latency, cost, gold-diff) and leaves TBD judge
// placeholders for the interactive LLM-judge pass, mirroring round 1.

import { fmtUsd } from './cost.ts';
import type { GoldDiff } from './score.ts';

export type CaseModelOutcome = {
  caseId: string;
  stage: number;
  kind: string;
  caseLabel: string;
  modelLabel: string;
  model: string;
  schemaOk: boolean;
  error?: string;
  latencyMs: number;
  latencies: number[];
  avgCostUsd: number | null;
  avgTokensIn: number;
  avgTokensOut: number;
  usedTool: boolean;
  stopReason: string | null;
  raw: string;
  gold?: GoldDiff;
};

export type CaseRecord = {
  id: string;
  stage: number;
  kind: string;
  label: string;
  built: boolean;
  skipReason?: string;
  sourceExcerpt: string;
  outcomes: CaseModelOutcome[];
};

export type RunResults = {
  startedAt: string;
  finishedAt: string;
  config: {
    models: string[];
    repeat: number;
    concurrency: number;
    timeoutMs: number;
    round: string;
  };
  cases: CaseRecord[];
};

function pct(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const r = (p / 100) * (s.length - 1);
  const lo = Math.floor(r);
  const hi = Math.ceil(r);
  return lo === hi ? s[lo]! : s[lo]! * (1 - (r - lo)) + s[hi]! * (r - lo);
}

export type Agg = {
  model: string;
  label: string;
  okCount: number;
  total: number;
  p50: number | null;
  p95: number | null;
  avgCost: number | null;
  totalCost: number;
  recall: number | null; // gold cases only
  bleed: number | null; // total forbidden hits across gold cases
};

export function aggregate(results: RunResults): Agg[] {
  const byModel = new Map<string, CaseModelOutcome[]>();
  for (const c of results.cases) {
    for (const o of c.outcomes) {
      const a = byModel.get(o.modelLabel) ?? [];
      a.push(o);
      byModel.set(o.modelLabel, a);
    }
  }
  const aggs: Agg[] = [];
  for (const label of results.config.models) {
    const os = byModel.get(label) ?? [];
    const lat = os.map((o) => o.latencyMs).filter((n) => n > 0);
    const costs = os.map((o) => o.avgCostUsd).filter((n): n is number => n !== null);
    const golds = os.map((o) => o.gold).filter((g): g is GoldDiff => Boolean(g));
    aggs.push({
      model: os[0]?.model ?? label,
      label,
      okCount: os.filter((o) => o.schemaOk).length,
      total: os.length,
      p50: pct(lat, 50),
      p95: pct(lat, 95),
      avgCost: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null,
      totalCost: costs.reduce((a, b) => a + b, 0),
      recall: golds.length ? golds.reduce((a, g) => a + g.recall, 0) / golds.length : null,
      bleed: golds.length ? golds.reduce((a, g) => a + g.bleed.length, 0) : null,
    });
  }
  aggs.sort((a, b) => {
    const ar = a.total ? a.okCount / a.total : 0;
    const br = b.total ? b.okCount / b.total : 0;
    if (ar !== br) return br - ar;
    return (a.p50 ?? 9e9) - (b.p50 ?? 9e9);
  });
  return aggs;
}

export function renderConsole(results: RunResults): void {
  const agg = aggregate(results);
  const rows = agg.map((a) => [
    a.label,
    `${a.okCount}/${a.total}`,
    a.p50 === null ? '-' : `${Math.round(a.p50)}ms`,
    fmtUsd(a.avgCost),
    fmtUsd(a.totalCost),
    a.recall === null ? '-' : `${Math.round(a.recall * 100)}%`,
    a.bleed === null ? '-' : String(a.bleed),
  ]);
  const headers = ['model', 'schema_ok', 'p50', '$/call', '$ total', 's3_recall', 's3_bleed'];
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const fmt = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join('  ');
  const lines = [
    `=== Dishton eval ${results.config.round} — ${results.startedAt} ===`,
    `models: ${results.config.models.join(', ')}  repeat=${results.config.repeat}`,
    '',
    fmt(headers),
    fmt(widths.map((w) => '-'.repeat(w))),
    ...rows.map(fmt),
  ];
  console.log(lines.join('\n'));
}

function goldBlock(g: GoldDiff): string[] {
  return [
    `- gold title match: ${g.titleOk ? '✅' : '❌ (picked the wrong dish/column)'}`,
    `- gold recall: ${Math.round(g.recall * 100)}% (${g.matched.length}/${g.matched.length + g.missing.length})`,
    `- gold bleed (foreign-column ingredients): ${g.bleed.length === 0 ? 'none ✅' : `${g.bleed.length} ❌ — ${g.bleed.join(', ')}`}`,
    `- missing: ${g.missing.length ? g.missing.join(', ') : 'none'}`,
    `- ingredients: ${g.ingredientCount}, steps: ${g.stepCount} (stepOk=${g.stepOk})`,
  ];
}

export async function writeMarkdown(results: RunResults, outPath: string): Promise<void> {
  const agg = aggregate(results);
  const md: string[] = [];
  md.push(`# Dishton eval — ${results.config.round}`);
  md.push('');
  md.push(`Run: ${results.startedAt} → ${results.finishedAt}`);
  md.push('');
  md.push('## Leaderboard');
  md.push('');
  md.push(
    '| model | schema_ok | p50 | p95 | $/call | $ total | s3 recall | s3 bleed | overall | completeness | fidelity | format |',
  );
  md.push(
    '|-------|-----------|-----|-----|--------|---------|-----------|----------|---------|--------------|----------|--------|',
  );
  for (const a of agg) {
    md.push(
      `| ${a.label} | ${a.okCount}/${a.total} | ${a.p50 === null ? '-' : `${Math.round(a.p50)}ms`} | ${a.p95 === null ? '-' : `${Math.round(a.p95)}ms`} | ${fmtUsd(a.avgCost)} | ${fmtUsd(a.totalCost)} | ${a.recall === null ? '-' : `${Math.round(a.recall * 100)}%`} | ${a.bleed === null ? '-' : a.bleed} | TBD | TBD | TBD | TBD |`,
    );
  }
  md.push('');
  md.push('## Run config');
  md.push(`- Models: ${results.config.models.join(', ')}`);
  md.push(`- Repeat: ${results.config.repeat}`);
  md.push(`- Concurrency: ${results.config.concurrency}`);
  md.push(`- Timeout: ${results.config.timeoutMs} ms`);
  md.push('');

  const stages = [...new Set(results.cases.map((c) => c.stage))].sort();
  for (const stage of stages) {
    md.push(`## Stage ${stage}`);
    md.push('');
    for (const c of results.cases.filter((x) => x.stage === stage)) {
      md.push(`### ${c.id} — ${c.label}`);
      md.push('');
      if (!c.built) {
        md.push(`_skipped: ${c.skipReason ?? 'unknown'}_`);
        md.push('');
        continue;
      }
      md.push('**Source / input:**');
      md.push('');
      md.push('```');
      md.push(c.sourceExcerpt);
      md.push('```');
      md.push('');
      for (const o of c.outcomes) {
        md.push(`#### ${o.modelLabel}`);
        md.push(
          `- schema_ok: ${o.schemaOk}${o.error ? ` — ${o.error}` : ''}`,
        );
        md.push(`- latency: ${o.latencyMs}ms (${o.latencies.join(', ')})`);
        md.push(
          `- cost: ${fmtUsd(o.avgCostUsd)}/call · tokens in/out: ${o.avgTokensIn}/${o.avgTokensOut}`,
        );
        md.push(`- used_tool: ${o.usedTool} · stop_reason: ${o.stopReason ?? '-'}`);
        if (o.gold) md.push(...goldBlock(o.gold));
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
  }
  await Deno.writeTextFile(outPath, md.join('\n'));
}
