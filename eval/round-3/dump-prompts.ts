// Writes the exact production prompts for every round-2 case (Stage 1 URLs,
// Stage 2 captions, Stage 3 photos) plus the extract_recipe tool definition to
// a directory, so a subagent can stand in for the API call. For image cases
// the user message's text goes to <id>.user.txt and the photo paths, in send
// order, to <id>.images.txt. The R2.1 prompt-experiment variant is skipped.
//
//   deno run --config eval/round-2/deno.json -A eval/round-3/dump-prompts.ts <out-dir>

import { loadCases } from '../round-2/cases.ts';
import { EXTRACT_RECIPE_TOOL } from '../../supabase/functions/_shared/ai/tool-schema.ts';

const out = Deno.args[0];
if (!out) throw new Error('usage: dump-prompts.ts <out-dir>');
await Deno.mkdir(out, { recursive: true });
await Deno.writeTextFile(`${out}/tool.json`, JSON.stringify(EXTRACT_RECIPE_TOOL, null, 2));
for (const c of await loadCases()) {
  if (c.id.endsWith('-r21')) continue;
  try {
    const b = await c.build();
    const sys = b.messages.find((m) => m.role === 'system')!.content as string;
    const userMsg = b.messages.find((m) => m.role === 'user')!.content;
    const user = typeof userMsg === 'string'
      ? userMsg
      : userMsg.map((blk) => (blk.type === 'text' ? blk.text : '')).join('\n');
    await Deno.writeTextFile(`${out}/${c.id}.system.txt`, sys);
    await Deno.writeTextFile(`${out}/${c.id}.user.txt`, user);
    if (b.imagePaths) {
      await Deno.writeTextFile(`${out}/${c.id}.images.txt`, `${b.imagePaths.join('\n')}\n`);
    }
    console.log('ok', c.id, c.label);
  } catch (e) {
    console.log('FAIL', c.id, c.label, (e as Error).message.slice(0, 100));
  }
}
