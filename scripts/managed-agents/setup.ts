// One-time control-plane setup: create the Environment + Agent for the
// recipe-drafting chat, then print their IDs to store as Supabase secrets.
//
//   ANTHROPIC_API_KEY=sk-ant-... deno run -A scripts/managed-agents/setup.ts
//
// Re-running creates a NEW environment + agent (the environment name is
// timestamped to stay unique). To update an existing agent's config instead,
// POST /v1/agents/{id} — see docs/runbooks/recipe-chat-setup.md.

import {
  MANAGED_AGENTS_BETA,
  RECIPE_AGENT_MODEL,
  RECIPE_AGENT_SYSTEM,
  RECIPE_AGENT_TOOLS,
} from '../../supabase/functions/_shared/agents/config.ts';

const KEY = Deno.env.get('ANTHROPIC_API_KEY');
if (!KEY) {
  console.error('Set ANTHROPIC_API_KEY in the environment.');
  Deno.exit(1);
}

const headers = {
  'x-api-key': KEY,
  'anthropic-version': '2023-06-01',
  'anthropic-beta': MANAGED_AGENTS_BETA,
  'content-type': 'application/json',
};

async function post(path: string, body: unknown): Promise<{ id: string }> {
  const res = await fetch(`https://api.anthropic.com${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`POST ${path} failed: ${res.status}\n${await res.text()}`);
    Deno.exit(1);
  }
  return (await res.json()) as { id: string };
}

const environment = await post('/v1/environments', {
  name: `dishton-recipe-drafter-${Date.now()}`,
  config: { type: 'cloud', networking: { type: 'limited' } },
});

const agent = await post('/v1/agents', {
  name: 'Dishton Recipe Drafter',
  model: RECIPE_AGENT_MODEL,
  system: RECIPE_AGENT_SYSTEM,
  tools: RECIPE_AGENT_TOOLS,
});

console.log('\nCreated. Set these as Supabase secrets (see the runbook):\n');
console.log(`  RECIPE_ENV_ID=${environment.id}`);
console.log(`  RECIPE_AGENT_ID=${agent.id}`);
