// Writes the exact production prompts for every text-lane case (round-2 Stage 1
// URLs + Stage 2 captions) plus the extract_recipe tool definition to a
// directory, so a subagent can stand in for the API call. Image cases are
// skipped — their photos are not committed.
//
//   deno run --config eval/round-2/deno.json -A eval/round-3/dump-prompts.ts <out-dir>

import { loadCases } from '../round-2/cases.ts';
import { EXTRACT_RECIPE_TOOL } from '../../supabase/functions/_shared/ai/tool-schema.ts';

const out = Deno.args[0];
if (!out) throw new Error('usage: dump-prompts.ts <out-dir>');
await Deno.mkdir(out, { recursive: true });
await Deno.writeTextFile(`${out}/tool.json`, JSON.stringify(EXTRACT_RECIPE_TOOL, null, 2));
for (const c of await loadCases()) {
  if (c.kind === 'image') continue;
  try {
    const b = await c.build();
    const sys = b.messages.find((m) => m.role === 'system')!.content as string;
    const user = b.messages.find((m) => m.role === 'user')!.content as string;
    await Deno.writeTextFile(`${out}/${c.id}.system.txt`, sys);
    await Deno.writeTextFile(`${out}/${c.id}.user.txt`, user);
    console.log('ok', c.id, c.label);
  } catch (e) {
    console.log('FAIL', c.id, c.label, (e as Error).message.slice(0, 100));
  }
}
