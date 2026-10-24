// Push the checked-in Recipe Drafter definition (model + effort, system
// prompt, tools) to the existing agent as a new version.
//
//   ANTHROPIC_API_KEY=sk-ant-... RECIPE_AGENT_ID=agent_... \
//     deno run -A scripts/managed-agents/update.ts
//
// Sessions created after this pick up the new version (recipe-chat-send
// references the agent by bare ID = latest). Sessions already running keep the
// version they were created on.

import {
  MANAGED_AGENTS_BETA,
  RECIPE_AGENT_MODEL_CONFIG,
  RECIPE_AGENT_SYSTEM,
  RECIPE_AGENT_TOOLS,
} from '../../supabase/functions/_shared/agents/config.ts';

const KEY = Deno.env.get('ANTHROPIC_API_KEY');
const AGENT_ID = Deno.env.get('RECIPE_AGENT_ID');
if (!KEY || !AGENT_ID) {
  console.error('Set ANTHROPIC_API_KEY and RECIPE_AGENT_ID in the environment.');
  Deno.exit(1);
}

const headers = {
  'x-api-key': KEY,
  'anthropic-version': '2023-06-01',
  'anthropic-beta': MANAGED_AGENTS_BETA,
  'content-type': 'application/json',
};

async function request(
  method: string,
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.anthropic.com${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`${method} ${path} failed: ${res.status}\n${await res.text()}`);
    Deno.exit(1);
  }
  return (await res.json()) as Record<string, unknown>;
}

// Pass the current version for optimistic concurrency: a 409 means someone
// else updated the agent in between — re-run to apply on top of theirs.
const current = await request('GET', `/v1/agents/${AGENT_ID}`);
const updated = await request('POST', `/v1/agents/${AGENT_ID}`, {
  version: current.version,
  model: RECIPE_AGENT_MODEL_CONFIG,
  system: RECIPE_AGENT_SYSTEM,
  tools: RECIPE_AGENT_TOOLS,
});

console.log(`\nUpdated ${AGENT_ID}: version ${current.version} -> ${updated.version}`);
console.log(`  model: ${JSON.stringify(updated.model)}`);
