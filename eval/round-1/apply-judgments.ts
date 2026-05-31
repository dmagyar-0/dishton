// Reads a NIM eval report Markdown and a judgments.json, then writes the
// report back with TBD placeholders filled in and the leaderboard table
// populated with per-model averages.
//
// Usage:
//   deno run --allow-read --allow-write apply-judgments.ts <report.md> <judgments.json>

type Judgment = {
  completeness: number;
  fidelity: number;
  format_hygiene: number;
  overall: number;
  notes: string;
};

type Judgments = Record<
  string, // URL_index "1".."6"
  Record<string, Judgment | string>
>;

const JUDGE_BLOCK = [
  '**Judge:**',
  '- Completeness: TBD',
  '- Fidelity: TBD',
  '- Format hygiene: TBD',
  '- Overall: TBD',
  '- Notes: TBD',
].join('\n');

function format(j: Judgment): string {
  return [
    '**Judge:**',
    `- Completeness: ${j.completeness}`,
    `- Fidelity: ${j.fidelity}`,
    `- Format hygiene: ${j.format_hygiene}`,
    `- Overall: ${j.overall}`,
    `- Notes: ${j.notes}`,
  ].join('\n');
}

function avg(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((n, x) => n + x, 0) / xs.length;
}

async function main() {
  const [reportPath, judgmentsPath] = Deno.args;
  if (!reportPath || !judgmentsPath) {
    console.error('usage: apply-judgments.ts <report.md> <judgments.json>');
    Deno.exit(2);
  }
  const judgments: Judgments = JSON.parse(await Deno.readTextFile(judgmentsPath));
  const original = await Deno.readTextFile(reportPath);
  const lines = original.split('\n');

  // Walk the file. Track current URL index (1..6) and current model under it.
  // Each `### URL N — ...` increments URL counter. Each `#### Model: X` sets
  // the current model. When we hit a TBD judge block, splice in the judgment.
  const out: string[] = [];
  let urlIdx = 0;
  let model: string | null = null;
  const perModelScores: Record<string, { c: number[]; f: number[]; fh: number[]; o: number[] }> = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith('### URL ')) {
      const m = line.match(/^### URL (\d+)/);
      if (m) urlIdx = parseInt(m[1]!, 10);
    }
    if (line.startsWith('#### Model: ')) {
      model = line.slice('#### Model: '.length).trim();
    }
    // Detect a Judge block start
    if (line === '**Judge:**' && lines.slice(i, i + 6).join('\n') === JUDGE_BLOCK) {
      const k = String(urlIdx);
      const cell = judgments[k]?.[model ?? ''];
      if (cell && typeof cell === 'object' && 'completeness' in cell) {
        const j = cell as Judgment;
        out.push(format(j));
        // Skip the next 5 lines (the original TBD lines)
        i += 5;
        // Track for leaderboard
        if (!perModelScores[model!]) {
          perModelScores[model!] = { c: [], f: [], fh: [], o: [] };
        }
        perModelScores[model!]!.c.push(j.completeness);
        perModelScores[model!]!.f.push(j.fidelity);
        perModelScores[model!]!.fh.push(j.format_hygiene);
        perModelScores[model!]!.o.push(j.overall);
        continue;
      }
    }
    out.push(line);
  }

  let result = out.join('\n');

  // Replace leaderboard rows. The leaderboard table is right after `## Leaderboard`.
  // For each row, replace the four trailing TBD cells with averages.
  // Pattern: `| <label> | <ok> | <p50> | TBD | TBD | TBD | TBD |`
  result = result.replace(
    /^\| (\S+(?:\.\d+)?(?:-\S+)*) \| (\d+\/\d+) \| (\d+(?: ms)?|-) \| TBD \| TBD \| TBD \| TBD \|$/gm,
    (full, label) => {
      const s = perModelScores[label];
      if (!s || s.o.length === 0) return full;
      const o = avg(s.o).toFixed(1);
      const c = avg(s.c).toFixed(1);
      const f = avg(s.f).toFixed(1);
      const fh = avg(s.fh).toFixed(1);
      const parts = full.split(' | ');
      // parts: ['| label', 'schema_ok', 'p50', 'TBD', 'TBD', 'TBD', 'TBD |']
      parts[3] = o;
      parts[4] = c;
      parts[5] = f;
      parts[6] = fh + ' |';
      return parts.join(' | ');
    },
  );

  await Deno.writeTextFile(reportPath, result);
  console.log('Applied judgments. Per-model averages:');
  for (const [m, s] of Object.entries(perModelScores)) {
    console.log(
      `  ${m.padEnd(15)} overall=${avg(s.o).toFixed(2)} completeness=${avg(s.c).toFixed(2)} fidelity=${avg(s.f).toFixed(2)} format=${avg(s.fh).toFixed(2)} (n=${s.o.length})`,
    );
  }
}

main();
