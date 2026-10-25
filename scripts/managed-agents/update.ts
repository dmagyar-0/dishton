// Sync the checked-in Recipe Drafter definition to Anthropic: the agent
// (model + effort, system prompt, tools) and its environment's networking.
// Run by the deploy workflow after every production deploy, by the manual
// "Sync recipe agent" workflow, or by hand:
//
//   ANTHROPIC_API_KEY=sk-ant-... deno run -A scripts/managed-agents/update.ts
//
// RECIPE_AGENT_ID / RECIPE_ENV_ID are optional; without them the agent is
// found by name and the environments by name prefix (both set by setup.ts).
// An unchanged agent is left alone, so re-running doesn't mint versions.
// Sessions created after an update use the new version; running ones keep
// the version they started on.

import {
  MANAGED_AGENTS_BETA,
  RECIPE_AGENT_MODEL_CONFIG,
  RECIPE_AGENT_NAME,
  RECIPE_AGENT_SYSTEM,
  RECIPE_AGENT_TOOLS,
  RECIPE_ENV_CONFIG,
  RECIPE_ENV_NAME_PREFIX,
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

type Json = Record<string, unknown>;

async function request(method: string, path: string, body?: unknown): Promise<Json> {
  const res = await fetch(`https://api.anthropic.com${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`${method} ${path} failed: ${res.status}\n${await res.text()}`);
    Deno.exit(1);
  }
  return (await res.json()) as Json;
}

async function listAll(path: string): Promise<Json[]> {
  const out: Json[] = [];
  let page: string | null = null;
  do {
    const query: string = page ? `?limit=100&page=${encodeURIComponent(page)}` : '?limit=100';
    const res = await request('GET', `${path}${query}`);
    out.push(...((res.data as Json[] | undefined) ?? []));
    page = (res.next_page as string | null | undefined) ?? null;
  } while (page);
  return out;
}

async function resolveAgentId(): Promise<string> {
  const fromEnv = Deno.env.get('RECIPE_AGENT_ID');
  if (fromEnv) return fromEnv;
  const matches = (await listAll('/v1/agents')).filter(
    (a) => a.name === RECIPE_AGENT_NAME && !a.archived_at,
  );
  if (matches.length !== 1) {
    console.error(`Found ${matches.length} agents named "${RECIPE_AGENT_NAME}".`);
    console.error('Set RECIPE_AGENT_ID to pick one.');
    Deno.exit(1);
  }
  return matches[0]?.id as string;
}

async function resolveEnvironmentIds(): Promise<string[]> {
  const fromEnv = Deno.env.get('RECIPE_ENV_ID');
  if (fromEnv) return [fromEnv];
  return (await listAll('/v1/environments'))
    .filter((e) => String(e.name ?? '').startsWith(RECIPE_ENV_NAME_PREFIX) && !e.archived_at)
    .map((e) => e.id as string);
}

// Compare what the agent's behaviour depends on. The API echoes tools with
// defaults filled in, so tools compare by name + enabled flags only.
function toolKey(tools: unknown): string {
  return JSON.stringify(
    ((tools as Json[] | undefined) ?? []).map((t) => ({
      name: t.name ?? t.type,
      configs: ((t.configs as Json[] | undefined) ?? []).map((c) => `${c.name}:${c.enabled}`),
    })),
  );
}

function effortOf(model: unknown): string | undefined {
  const effort = (model as Json | undefined)?.effort;
  return typeof effort === 'string' ? effort : ((effort as Json | undefined)?.type as string);
}

const agentId = await resolveAgentId();
const current = await request('GET', `/v1/agents/${agentId}`);
const currentModel = current.model as Json | string;
const currentModelId = typeof currentModel === 'string' ? currentModel : currentModel.id;
const unchanged =
  current.system === RECIPE_AGENT_SYSTEM &&
  currentModelId === RECIPE_AGENT_MODEL_CONFIG.id &&
  effortOf(currentModel) === RECIPE_AGENT_MODEL_CONFIG.effort &&
  toolKey(current.tools) === toolKey(RECIPE_AGENT_TOOLS);

if (unchanged) {
  console.log(`Agent ${agentId} already matches config.ts (version ${current.version}).`);
} else {
  // Pass the current version for optimistic concurrency: a 409 means someone
  // else updated the agent in between — re-run to apply on top of theirs.
  const updated = await request('POST', `/v1/agents/${agentId}`, {
    version: current.version,
    model: RECIPE_AGENT_MODEL_CONFIG,
    system: RECIPE_AGENT_SYSTEM,
    tools: RECIPE_AGENT_TOOLS,
  });
  console.log(`Updated agent ${agentId}: version ${current.version} -> ${updated.version}`);
  console.log(`  model: ${JSON.stringify(updated.model)}`);
}

const environmentIds = await resolveEnvironmentIds();
if (environmentIds.length === 0) {
  console.error(`No environment named ${RECIPE_ENV_NAME_PREFIX}*; set RECIPE_ENV_ID.`);
  Deno.exit(1);
}
for (const id of environmentIds) {
  // Applies to new session containers only; running sessions keep theirs.
  await request('POST', `/v1/environments/${id}`, { config: RECIPE_ENV_CONFIG });
  console.log(`Environment ${id}: networking ${RECIPE_ENV_CONFIG.networking.type}`);
}
