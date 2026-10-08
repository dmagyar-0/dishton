// Schema-validates every extract_recipe output in a directory against the
// canonical Recipe Zod schema and prints a one-line summary per file.
//
//   deno run --config eval/round-2/deno.json -A eval/round-3/score.ts eval/round-3/outputs/v2-tuned-prompt

import { validateSchema } from '../round-2/score.ts';

const dir = Deno.args[0];
if (!dir) throw new Error('usage: score.ts <dir>');
const files = [...Deno.readDirSync(dir)].map((e) => e.name).filter((n) => n.endsWith('.json')).sort();
for (const f of files) {
  const r = validateSchema(Deno.readTextFileSync(`${dir}/${f}`));
  if (!r.ok) {
    console.log(f, 'FAIL', r.error);
    continue;
  }
  const x = r.recipe;
  const nsq = x.ingredients.filter((i) => i.non_scalable_qty).length;
  console.log(f, 'ok', JSON.stringify({ title: x.title, servings: x.servings, ingredients: x.ingredients.length, steps: x.steps.length, non_scalable: nsq }));
}
