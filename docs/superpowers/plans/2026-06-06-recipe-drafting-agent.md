# Recipe-Drafting Agent (Managed Agents) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-app, conversational recipe-drafting agent (Anthropic Managed Agents) that learns the household's taste, web-searches for inspiration, drafts a schema-valid recipe shown as a live preview, iterates on chat feedback, and saves to the pantry on an explicit click.

**Architecture:** SPA chat panel ↔ Supabase Edge Functions (`recipe-chat-send`, `recipe-chat-webhook`, `recipe-chat-save`) ↔ Anthropic Managed Agents (stateful session). The session runs on Anthropic's side; our webhook resolves the agent's custom-tool calls (read recipes / present draft) against Supabase and is delivered to the browser via Supabase Realtime. The data write goes through the existing `save_recipe` RPC under the user's JWT.

**Tech Stack:** Deno edge functions (raw `fetch` to the Managed Agents REST API + Web Crypto HMAC for webhook verification — **not** the pinned `@anthropic-ai/sdk@^0.40.0`, which lacks Managed Agents), Postgres migrations + RLS, React/Vite SPA (TanStack Router/Query, Supabase Realtime), Zod (`Recipe` schema), Vitest + Deno test + Playwright.

---

## Critical context & decisions

- **No SDK bump.** The new functions call the Managed Agents REST API with `fetch` and the beta header `managed-agents-2026-04-01`. This keeps the existing import functions' `@anthropic-ai/sdk@^0.40.0` pin untouched (a major bump would risk their `Anthropic.Tool` / `MessageCreateParamsNonStreaming` type usage).
- **Webhook verification is implemented manually** with Web Crypto (HMAC-SHA256, Svix-style `webhook-id`/`webhook-timestamp`/`webhook-signature` headers), since the SDK's `webhooks.unwrap()` isn't available at the pinned version. It is fully unit-tested.
- **Credential boundary (manual steps the repo owner runs, not the implementer):** creating the real Agent + Environment (Phase 4 script needs `ANTHROPIC_API_KEY`), registering the webhook URL in the Anthropic Console, `supabase secrets set`, and deploying the functions. The implementer writes the code and the runbook; these four steps are executed by the owner with their key. All code is testable locally without a key via mock mode (below).
- **Agent mock mode.** `_shared/agents/transport.ts` honors `AI_MOCK_MODE` (same env var as the existing AI path) so local dev, unit tests, and Playwright can run the full flow against canned agent responses with no Anthropic key.
- **HTTP server:** use `serve` from `https://deno.land/std@0.224.0/http/server.ts` (the codebase convention), not `Deno.serve`.
- **Shared helpers live in `_shared/auth.ts`:** `resolveCaller`, `corsHeaders`, `jsonResponse`, `HttpError` (there is no `cors.ts`).
- **Test file suffix:** `_test.ts` (Deno convention in this repo).

## File structure

**Create**
- `supabase/migrations/20260606120000_recipe_chat.sql` — two tables, RLS, helpers, realtime, grants.
- `supabase/tests/recipe_chat.test.sql` — RLS coverage.
- `supabase/functions/_shared/agents/config.ts` — model, system prompt, tool schemas.
- `supabase/functions/_shared/agents/transport.ts` — raw-HTTP Managed Agents calls + mock mode.
- `supabase/functions/_shared/agents/transport_test.ts`
- `supabase/functions/_shared/agents/webhook.ts` — HMAC verify.
- `supabase/functions/_shared/agents/webhook_test.ts`
- `supabase/functions/_shared/agents/recipe-tools.ts` — execute custom tools (read recipes / validate draft).
- `supabase/functions/_shared/agents/recipe-tools_test.ts`
- `supabase/functions/recipe-chat-send/index.ts`
- `supabase/functions/recipe-chat-send/_test.ts`
- `supabase/functions/recipe-chat-webhook/index.ts`
- `supabase/functions/recipe-chat-webhook/_test.ts`
- `supabase/functions/recipe-chat-save/index.ts`
- `supabase/functions/recipe-chat-save/_test.ts`
- `scripts/managed-agents/setup.ts` — one-time Agent+Environment creation (owner runs).
- `docs/runbooks/recipe-chat-setup.md` — manual setup runbook.
- `src/lib/queries/recipe-chat.ts` — `useRecipeChat` hook (realtime + sends).
- `src/ui/recipe/DraftPreviewCard.tsx` + `.test.tsx`
- `src/ui/recipe/chat/ChatThread.tsx` + `.test.tsx`
- `src/ui/recipe/chat/ChatComposer.tsx`
- `src/routes/h/$householdId/draft.tsx`
- `e2e/recipe-chat.spec.ts`

**Modify**
- `supabase/functions/_shared/env.ts` — add `RECIPE_AGENT_ID`, `RECIPE_ENV_ID`, `ANTHROPIC_WEBHOOK_SIGNING_KEY`.
- `src/lib/i18n.en.ts`, `src/lib/i18n.de.ts` — add a `chat` group.
- `src/routes/h/$householdId/index.tsx` — "Draft with AI" header button.
- `src/ui/shell/AppShell.tsx` — nav entry.

---

## Phase 1 — Database

### Task 1: Migration for chat tables, RLS, realtime

**Files:**
- Create: `supabase/migrations/20260606120000_recipe_chat.sql`

- [ ] **Step 1: Write the migration**

```sql
set search_path = app, public;

-- Conversational recipe-drafting sessions. Each row maps to an Anthropic
-- Managed Agents session. The webhook updates rows via the service role
-- (bypasses RLS); the send/save functions and SPA read/insert under the
-- caller's JWT, governed by the policies below.
create table app.recipe_chat_sessions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references app.households(id) on delete cascade,
  created_by uuid not null references app.profiles(id),
  anthropic_session_id text not null unique,
  status text not null default 'running'
    check (status in ('running','idle','saved','error','terminated')),
  current_draft jsonb,
  events_cursor text,
  draft_repair_attempts integer not null default 0,
  title text,
  recipe_id uuid references app.recipes(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index recipe_chat_sessions_household_idx
  on app.recipe_chat_sessions (household_id, created_at desc);

create trigger recipe_chat_sessions_set_updated before update
  on app.recipe_chat_sessions
  for each row execute function app.set_updated_at();

create table app.recipe_chat_messages (
  id uuid primary key default gen_random_uuid(),
  chat_session_id uuid not null
    references app.recipe_chat_sessions(id) on delete cascade,
  role text not null check (role in ('user','agent')),
  content text not null,
  created_at timestamptz not null default now()
);
create index recipe_chat_messages_session_idx
  on app.recipe_chat_messages (chat_session_id, created_at);

-- Recipe-chat-scoped RLS helpers (SECURITY DEFINER + plpgsql to prevent
-- inlining, mirroring app.is_recipe_visible / app.is_recipe_editor).
create or replace function app.is_chat_session_visible(s uuid)
returns boolean language plpgsql stable security definer
set search_path = app, public as $$
declare result boolean;
begin
  select app.is_household_member(cs.household_id) into result
    from app.recipe_chat_sessions cs where cs.id = s;
  return coalesce(result, false);
end;
$$;

create or replace function app.is_chat_session_editor(s uuid)
returns boolean language plpgsql stable security definer
set search_path = app, public as $$
declare result boolean;
begin
  select app.is_household_editor(cs.household_id) into result
    from app.recipe_chat_sessions cs where cs.id = s;
  return coalesce(result, false);
end;
$$;

alter table app.recipe_chat_sessions enable row level security;
alter table app.recipe_chat_messages enable row level security;

create policy recipe_chat_sessions_read on app.recipe_chat_sessions
  for select using (app.is_household_member(household_id));
create policy recipe_chat_sessions_write on app.recipe_chat_sessions
  for all using (app.is_household_editor(household_id))
  with check (app.is_household_editor(household_id));

create policy recipe_chat_messages_read on app.recipe_chat_messages
  for select using (app.is_chat_session_visible(chat_session_id));
create policy recipe_chat_messages_write on app.recipe_chat_messages
  for all using (app.is_chat_session_editor(chat_session_id))
  with check (app.is_chat_session_editor(chat_session_id));

grant select, insert, update, delete on app.recipe_chat_sessions to authenticated;
grant select, insert, update, delete on app.recipe_chat_messages to authenticated;

do $$ begin
  alter publication supabase_realtime add table app.recipe_chat_sessions;
exception when duplicate_object then null; when undefined_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table app.recipe_chat_messages;
exception when duplicate_object then null; when undefined_object then null; end $$;
```

- [ ] **Step 2: Apply and verify**

Run: `pnpm db:reset`
Expected: completes without error; the two tables exist.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260606120000_recipe_chat.sql
git commit -m "feat(db): recipe chat sessions + messages tables, RLS, realtime"
```

### Task 2: RLS test

**Files:**
- Create: `supabase/tests/recipe_chat.test.sql`

This mirrors `supabase/tests/rls.test.sql`: insert personas into `auth.users`/`app.profiles`/`app.households`/`app.household_members`, then assert an **editor** can create/read a session+message and a **non-member** cannot. The runner wraps the file in `begin; ... rollback;` and reads a final `select label, ok` as TAP rows.

- [ ] **Step 1: Write the test**

```sql
-- Personas: E = editor of H1; X = unrelated (no membership).
create temp table _t_results (label text, ok boolean) on commit drop;

create or replace function pg_temp.check_as(p_label text, p_ok boolean)
returns void language plpgsql as $$
begin insert into _t_results values (p_label, coalesce(p_ok, false)); end; $$;

-- Fixtures (disable the auth trigger around auth.users inserts).
alter table auth.users disable trigger on_auth_user_created;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1','e@test.dev'),
  ('00000000-0000-0000-0000-0000000000x1','x@test.dev');
alter table auth.users enable trigger on_auth_user_created;

insert into app.profiles (id, display_name) values
  ('00000000-0000-0000-0000-0000000000e1','Editor'),
  ('00000000-0000-0000-0000-0000000000x1','Stranger');

insert into app.households (id, name) values
  ('11111111-0000-0000-0000-000000000001','H1');

insert into app.household_members (household_id, profile_id, role) values
  ('11111111-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e1','editor');

-- Seed a session owned by H1 directly (bypassing RLS as postgres).
insert into app.recipe_chat_sessions (id, household_id, created_by, anthropic_session_id)
values ('22222222-0000-0000-0000-000000000001',
        '11111111-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000e1', 'sesn_test_1');

-- Persona query helpers: set role + jwt claim, run, reset.
create or replace function pg_temp.q_session_count(p_persona uuid, p_session uuid)
returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims',
    json_build_object('sub',p_persona::text,'role','authenticated')::text, true);
  select count(*) into n from app.recipe_chat_sessions where id = p_session;
  perform set_config('role','postgres',true);
  return n;
end; $$;

create or replace function pg_temp.q_insert_message(p_persona uuid, p_session uuid)
returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims',
    json_build_object('sub',p_persona::text,'role','authenticated')::text, true);
  begin
    insert into app.recipe_chat_messages (chat_session_id, role, content)
    values (p_session,'user','hi');
    get diagnostics n = row_count;
  exception when others then n := 0;
  end;
  perform set_config('role','postgres',true);
  return n;
end; $$;

select pg_temp.check_as('editor can see own household session',
  pg_temp.q_session_count('00000000-0000-0000-0000-0000000000e1'::uuid,
                          '22222222-0000-0000-0000-000000000001'::uuid) = 1);

select pg_temp.check_as('stranger cannot see the session',
  pg_temp.q_session_count('00000000-0000-0000-0000-0000000000x1'::uuid,
                          '22222222-0000-0000-0000-000000000001'::uuid) = 0);

select pg_temp.check_as('editor can insert a message',
  pg_temp.q_insert_message('00000000-0000-0000-0000-0000000000e1'::uuid,
                           '22222222-0000-0000-0000-000000000001'::uuid) = 1);

select pg_temp.check_as('stranger cannot insert a message',
  pg_temp.q_insert_message('00000000-0000-0000-0000-0000000000x1'::uuid,
                           '22222222-0000-0000-0000-000000000001'::uuid) = 0);

select label, ok from _t_results order by label;
```

- [ ] **Step 2: Run the DB tests**

Run: `pnpm test:db`
Expected: the four `recipe_chat` assertions pass (all `ok = true`).

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/recipe_chat.test.sql
git commit -m "test(db): RLS coverage for recipe chat tables"
```

---

## Phase 2 — Shared Managed Agents module

### Task 3: Add env vars

**Files:**
- Modify: `supabase/functions/_shared/env.ts`

- [ ] **Step 1: Add the three keys to the env accessor**

Read `_shared/env.ts` first to match its exact shape (it is a lazy Proxy over `Deno.env`). Add `RECIPE_AGENT_ID`, `RECIPE_ENV_ID`, and `ANTHROPIC_WEBHOOK_SIGNING_KEY` to the set of known keys, following the existing pattern for `ANTHROPIC_API_KEY` (optional/required handling identical to other Anthropic keys). Keep `ANTHROPIC_API_KEY` as-is.

- [ ] **Step 2: Typecheck the function config**

Run: `deno check --config supabase/functions/deno.json supabase/functions/_shared/env.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/env.ts
git commit -m "feat(edge): add recipe-chat env vars"
```

### Task 4: Agent config (model, system prompt, tool schemas)

**Files:**
- Create: `supabase/functions/_shared/agents/config.ts`

- [ ] **Step 1: Write the config module**

```ts
// Static, version-controlled definition of the Recipe Drafter agent. Imported
// by both the one-time setup script and the webhook (for the tool schemas).

export const RECIPE_AGENT_MODEL = 'claude-sonnet-4-6';
export const RECIPE_AGENT_EFFORT = 'medium';
export const MANAGED_AGENTS_BETA = 'managed-agents-2026-04-01';

export const RECIPE_AGENT_SYSTEM = `You are Dishton's recipe drafter — a collaborative cook who turns a vibe and optional ingredients into a single, well-tested recipe.

Workflow:
1. Understand the request. Ask a brief clarifying question ONLY when the request is genuinely ambiguous; otherwise proceed.
2. Call list_my_recipes early to learn the household's taste (cuisines, ingredients, units, language). Use get_recipe only to drill into a specific recipe the user references.
3. Use web_search sparingly (1-2 searches) for technique, ratios, or inspiration — not for every turn.
4. Produce a complete draft by calling present_draft with a full recipe. Match the household's prevailing unit system and language. Set source_type to "manual".
5. Explain the draft in one short message, then iterate on the user's feedback by calling present_draft again.

Never save the recipe — the human clicks "Save to pantry". Keep responses concise.`;

export const LIST_MY_RECIPES_TOOL = {
  type: 'custom',
  name: 'list_my_recipes',
  description:
    "List the household's existing recipes (compact: titles, tags, key ingredients, unit system, language) to learn its taste. Omits full steps.",
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Optional keyword filter on title/tags.' },
      limit: { type: 'integer', description: 'Max recipes to return (default 50).' },
    },
    required: [],
  },
} as const;

export const GET_RECIPE_TOOL = {
  type: 'custom',
  name: 'get_recipe',
  description: 'Fetch one full recipe (ingredients + steps) by id, for drill-down.',
  input_schema: {
    type: 'object',
    properties: { recipe_id: { type: 'string' } },
    required: ['recipe_id'],
  },
} as const;

// Mirrors the existing extract_recipe tool shape (hardcoded for model
// reliability). Validation against the Recipe Zod schema is the source of truth.
export const PRESENT_DRAFT_TOOL = {
  type: 'custom',
  name: 'present_draft',
  description:
    'Present the current recipe draft to the user. Call this whenever you have a new or revised draft. The full recipe object is required.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      description: { type: ['string', 'null'] },
      source_type: { type: 'string', enum: ['manual'] },
      source_url: { type: ['string', 'null'] },
      source_language: { type: 'string', description: 'BCP-47, e.g. "en".' },
      canonical_unit_system: { type: 'string', enum: ['metric', 'imperial'] },
      servings: { type: 'integer' },
      total_time_min: { type: ['integer', 'null'] },
      hero_image_path: { type: ['string', 'null'] },
      tags: { type: 'array', items: { type: 'string' } },
      ingredients: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            position: { type: 'integer' },
            raw_text: { type: 'string' },
            quantity: {},
            unit: { type: ['string', 'null'] },
            ingredient_name: { type: ['string', 'null'] },
            notes: { type: ['string', 'null'] },
            scalable: { type: 'boolean' },
            non_scalable_qty: { type: ['string', 'null'] },
            section: { type: ['string', 'null'] },
          },
          required: ['position', 'raw_text'],
        },
      },
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            position: { type: 'integer' },
            body: { type: 'string' },
            duration_min: { type: ['integer', 'null'] },
          },
          required: ['position', 'body'],
        },
      },
    },
    required: ['title', 'canonical_unit_system', 'servings', 'ingredients', 'steps'],
  },
} as const;

export const RECIPE_AGENT_TOOLS = [
  { type: 'agent_toolset_20260401',
    default_config: { enabled: false },
    configs: [
      { name: 'web_search', enabled: true },
      { name: 'web_fetch', enabled: true },
    ] },
  LIST_MY_RECIPES_TOOL,
  GET_RECIPE_TOOL,
  PRESENT_DRAFT_TOOL,
];
```

- [ ] **Step 2: Typecheck**

Run: `deno check --config supabase/functions/deno.json supabase/functions/_shared/agents/config.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/agents/config.ts
git commit -m "feat(agents): recipe drafter agent config + tool schemas"
```

### Task 5: Transport (raw-HTTP Managed Agents calls + mock mode)

**Files:**
- Create: `supabase/functions/_shared/agents/transport.ts`
- Test: `supabase/functions/_shared/agents/transport_test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { assert, assertEquals } from 'jsr:@std/assert';
import { installMockFetch, jsonResponse } from '../mock_fetch.ts';

Deno.env.set('ANTHROPIC_API_KEY', 'test-key');

Deno.test('createSession posts to /v1/sessions with the beta header', async () => {
  const { createSession } = await import('./transport.ts');
  using mock = installMockFetch([
    { match: (r) => r.url.endsWith('/v1/sessions'),
      response: () => jsonResponse({ id: 'sesn_1', status: 'running' }) },
  ]);
  const s = await createSession({ agentId: 'agent_1', environmentId: 'env_1' });
  assertEquals(s.id, 'sesn_1');
  const req = mock.calls[0]!;
  assertEquals(req.headers.get('anthropic-beta'), 'managed-agents-2026-04-01');
  assertEquals(req.headers.get('x-api-key'), 'test-key');
});

Deno.test('mock mode returns a canned session without any fetch', async () => {
  Deno.env.set('AI_MOCK_MODE', '1');
  const { createSession } = await import('./transport.ts');
  const s = await createSession({ agentId: 'a', environmentId: 'e' });
  assert(s.id.startsWith('sesn_mock'));
  Deno.env.delete('AI_MOCK_MODE');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test -A --config supabase/functions/deno.json supabase/functions/_shared/agents/transport_test.ts`
Expected: FAIL (module `./transport.ts` not found).

- [ ] **Step 3: Implement the transport**

```ts
// Raw-HTTP client for the Anthropic Managed Agents REST API. We deliberately
// avoid @anthropic-ai/sdk here: the version pinned for the import functions
// (^0.40.0) predates Managed Agents. Mock mode mirrors _shared/ai/mock.ts.

import { env } from '../env.ts';
import { isMockMode } from '../ai/mock.ts';

const BASE = 'https://api.anthropic.com';
const BETA = 'managed-agents-2026-04-01';

function headers(): HeadersInit {
  return {
    'x-api-key': env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': BETA,
    'content-type': 'application/json',
  };
}

async function call(path: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: headers() });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`managed-agents ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

export type Session = { id: string; status: string };
export type AgentEvent = {
  id: string;
  type: string;
  // present on agent.custom_tool_use:
  name?: string;
  input?: Record<string, unknown>;
  // present on agent.message:
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: { type: string } | null;
};

export async function createSession(opts: {
  agentId: string;
  environmentId: string;
  title?: string;
}): Promise<Session> {
  if (isMockMode()) return { id: `sesn_mock_${crypto.randomUUID()}`, status: 'running' };
  return (await call('/v1/sessions', {
    method: 'POST',
    body: JSON.stringify({
      agent: opts.agentId,
      environment_id: opts.environmentId,
      title: opts.title,
    }),
  })) as Session;
}

export async function sendUserMessage(sessionId: string, text: string): Promise<void> {
  if (isMockMode()) return;
  await call(`/v1/sessions/${sessionId}/events`, {
    method: 'POST',
    body: JSON.stringify({
      events: [{ type: 'user.message', content: [{ type: 'text', text }] }],
    }),
  });
}

export async function sendToolResult(
  sessionId: string,
  toolUseId: string,
  result: unknown,
  isError = false,
): Promise<void> {
  if (isMockMode()) return;
  await call(`/v1/sessions/${sessionId}/events`, {
    method: 'POST',
    body: JSON.stringify({
      events: [{
        type: 'user.custom_tool_result',
        custom_tool_use_id: toolUseId,
        content: [{ type: 'text', text: JSON.stringify(result) }],
        is_error: isError,
      }],
    }),
  });
}

export async function listEvents(sessionId: string): Promise<AgentEvent[]> {
  if (isMockMode()) return [];
  const data = (await call(`/v1/sessions/${sessionId}/events?limit=1000`, {
    method: 'GET',
  })) as { data: AgentEvent[] };
  return data.data ?? [];
}

export async function archiveSession(sessionId: string): Promise<void> {
  if (isMockMode()) return;
  await call(`/v1/sessions/${sessionId}/archive`, { method: 'POST', body: '{}' });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `deno test -A --config supabase/functions/deno.json supabase/functions/_shared/agents/transport_test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/agents/transport.ts supabase/functions/_shared/agents/transport_test.ts
git commit -m "feat(agents): raw-HTTP managed-agents transport with mock mode"
```

### Task 6: Webhook HMAC verification

**Files:**
- Create: `supabase/functions/_shared/agents/webhook.ts`
- Test: `supabase/functions/_shared/agents/webhook_test.ts`

Anthropic webhooks sign with a `whsec_`-prefixed secret (base64 after the prefix). The signed content is `${id}.${timestamp}.${rawBody}`; the `webhook-signature` header is a space-separated list of `v1,<base64 HMAC-SHA256>` entries. We verify with Web Crypto.

- [ ] **Step 1: Write the failing test**

```ts
import { assert, assertEquals } from 'jsr:@std/assert';
import { encodeBase64 } from 'jsr:@std/encoding/base64';
import { verifyWebhook } from './webhook.ts';

const SECRET_B64 = encodeBase64(new TextEncoder().encode('topsecret'));
const SECRET = `whsec_${SECRET_B64}`;

async function sign(id: string, ts: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode('topsecret'),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key,
    new TextEncoder().encode(`${id}.${ts}.${body}`));
  return `v1,${encodeBase64(new Uint8Array(mac))}`;
}

Deno.test('verifyWebhook accepts a valid signature', async () => {
  const body = JSON.stringify({ type: 'event', id: 'event_1' });
  const id = 'msg_1';
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = await sign(id, ts, body);
  const ok = await verifyWebhook(SECRET, body, {
    'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': sig,
  });
  assert(ok);
});

Deno.test('verifyWebhook rejects a tampered body', async () => {
  const id = 'msg_1';
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = await sign(id, ts, '{"a":1}');
  const ok = await verifyWebhook(SECRET, '{"a":2}', {
    'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': sig,
  });
  assertEquals(ok, false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test -A --config supabase/functions/deno.json supabase/functions/_shared/agents/webhook_test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
import { decodeBase64, encodeBase64 } from 'jsr:@std/encoding/base64';

// Constant-time compare of two base64 signature strings.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyWebhook(
  signingSecret: string,
  rawBody: string,
  h: { 'webhook-id'?: string; 'webhook-timestamp'?: string; 'webhook-signature'?: string },
): Promise<boolean> {
  const id = h['webhook-id'];
  const ts = h['webhook-timestamp'];
  const sigHeader = h['webhook-signature'];
  if (!id || !ts || !sigHeader || !signingSecret.startsWith('whsec_')) return false;

  // Reject deliveries older than ~5 minutes.
  const ageSec = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(ageSec) || ageSec > 300) return false;

  const keyBytes = decodeBase64(signingSecret.slice('whsec_'.length));
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(`${id}.${ts}.${rawBody}`));
  const expected = encodeBase64(new Uint8Array(mac));

  // Header may carry multiple space-separated "v1,<sig>" entries.
  return sigHeader.split(' ').some((entry) => {
    const [, sig] = entry.split(',');
    return sig ? safeEqual(sig, expected) : false;
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `deno test -A --config supabase/functions/deno.json supabase/functions/_shared/agents/webhook_test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/agents/webhook.ts supabase/functions/_shared/agents/webhook_test.ts
git commit -m "feat(agents): HMAC webhook verification"
```

### Task 7: Recipe-tools executor (read recipes + validate draft)

**Files:**
- Create: `supabase/functions/_shared/agents/recipe-tools.ts`
- Test: `supabase/functions/_shared/agents/recipe-tools_test.ts`

This module executes the custom tools server-side. It takes a **service-role** Supabase client (built by the webhook) plus the bound `householdId`, and the `Recipe` schema for `present_draft` validation. `normalizePositions` is reused conceptually (re-implemented locally to avoid importing the recipe-specific AI module).

- [ ] **Step 1: Write the failing test**

```ts
import { assert, assertEquals } from 'jsr:@std/assert';
import { validateDraft } from './recipe-tools.ts';

const VALID = {
  title: 'Test Soup', description: null, source_type: 'manual', source_url: null,
  source_language: 'en', canonical_unit_system: 'metric', servings: 4,
  total_time_min: 30, hero_image_path: null, tags: ['soup'],
  ingredients: [{ position: 5, raw_text: '1 onion', quantity: 1, unit: null,
    ingredient_name: 'onion', notes: null, scalable: true,
    non_scalable_qty: null, section: null }],
  steps: [{ position: 2, body: 'Chop and simmer.', duration_min: 30 }],
};

Deno.test('validateDraft accepts a valid recipe and renumbers positions', () => {
  const res = validateDraft(VALID);
  assert(res.ok);
  if (res.ok) {
    assertEquals(res.recipe.ingredients[0]!.position, 0);
    assertEquals(res.recipe.steps[0]!.position, 0);
  }
});

Deno.test('validateDraft reports errors for an invalid recipe', () => {
  const res = validateDraft({ ...VALID, title: '' });
  assert(!res.ok);
  if (!res.ok) assert(res.errors.length > 0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test -A --config supabase/functions/deno.json supabase/functions/_shared/agents/recipe-tools_test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
import { Recipe, type Recipe as RecipeType } from '../domain/recipe.ts';
import type { AppClient } from '../auth.ts';

export type DraftValidation =
  | { ok: true; recipe: RecipeType }
  | { ok: false; errors: string[] };

export function validateDraft(input: unknown): DraftValidation {
  const parsed = Recipe.safeParse(input);
  if (!parsed.success) {
    const errors = parsed.error.issues
      .slice(0, 20)
      .map((i) => `${i.path.join('.')}: ${i.message}`);
    return { ok: false, errors };
  }
  const r = parsed.data;
  return {
    ok: true,
    recipe: {
      ...r,
      ingredients: r.ingredients.map((ing, i) => ({ ...ing, position: i })),
      steps: r.steps.map((s, i) => ({ ...s, position: i })),
    },
  };
}

// Compact taste summary — titles, tags, key ingredient names, units, language.
export async function listMyRecipes(
  client: AppClient,
  householdId: string,
  opts: { query?: string; limit?: number },
): Promise<unknown> {
  const limit = Math.min(opts.limit ?? 50, 100);
  let q = client
    .from('recipes')
    .select('id, title, canonical_unit_system, source_language, recipe_tags(tag), recipe_ingredients(ingredient_name)')
    .eq('household_id', householdId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (opts.query) q = q.ilike('title', `%${opts.query}%`);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    id: string; title: string; canonical_unit_system: string; source_language: string;
    recipe_tags: { tag: string }[]; recipe_ingredients: { ingredient_name: string | null }[];
  }>;
  return {
    count: rows.length,
    recipes: rows.map((r) => ({
      id: r.id,
      title: r.title,
      unit_system: r.canonical_unit_system,
      language: r.source_language,
      tags: r.recipe_tags.map((t) => t.tag),
      key_ingredients: r.recipe_ingredients
        .map((i) => i.ingredient_name)
        .filter((n): n is string => !!n)
        .slice(0, 12),
    })),
  };
}

export async function getRecipe(
  client: AppClient,
  householdId: string,
  recipeId: string,
): Promise<unknown> {
  const [r, ings, steps, tags] = await Promise.all([
    client.from('recipes').select('*').eq('id', recipeId).eq('household_id', householdId).single(),
    client.from('recipe_ingredients').select('*').eq('recipe_id', recipeId).order('position'),
    client.from('recipe_steps').select('*').eq('recipe_id', recipeId).order('position'),
    client.from('recipe_tags').select('tag').eq('recipe_id', recipeId),
  ]);
  if (r.error) throw r.error;
  return {
    recipe: r.data, ingredients: ings.data ?? [], steps: steps.data ?? [],
    tags: ((tags.data ?? []) as { tag: string }[]).map((t) => t.tag),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `deno test -A --config supabase/functions/deno.json supabase/functions/_shared/agents/recipe-tools_test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/agents/recipe-tools.ts supabase/functions/_shared/agents/recipe-tools_test.ts
git commit -m "feat(agents): custom-tool executors + draft validation"
```

---

## Phase 3 — Edge functions

> All three follow the `translate-recipe` skeleton: `serve(async (req) => { const cors = corsHeaders(req.headers.get('origin')); if (OPTIONS) ...; try { caller = await resolveCaller(req); body = Body.parse(await req.json()); ...; return jsonResponse(..., 200, cors); } catch (e) { if (e instanceof HttpError) { const res = e.toResponse(); copy cors; return res; } return jsonResponse({error:'internal'},500,cors); } })`. The webhook function does **not** call `resolveCaller` (it's Anthropic→us, verified by HMAC).

### Task 8: `recipe-chat-send`

**Files:**
- Create: `supabase/functions/recipe-chat-send/index.ts`
- Test: `supabase/functions/recipe-chat-send/_test.ts`

- [ ] **Step 1: Write the failing test** (mock mode; no agent key needed)

```ts
import { assert, assertEquals } from 'jsr:@std/assert';

Deno.env.set('SUPABASE_URL', 'https://test.supabase.co');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-role');
Deno.env.set('ANTHROPIC_API_KEY', 'test-key');
Deno.env.set('RECIPE_AGENT_ID', 'agent_1');
Deno.env.set('RECIPE_ENV_ID', 'env_1');
Deno.env.set('AI_MOCK_MODE', '1');

Deno.test('recipe-chat-send rejects a request with no auth header', async () => {
  const { handler } = await import('./index.ts');
  const res = await handler(new Request('http://localhost', {
    method: 'POST', body: JSON.stringify({ message: 'hi', household_id: 'h' }),
  }));
  assertEquals(res.status, 401);
});
```

> Note: refactor the function so the `serve()` callback is an exported `handler` (i.e. `export const handler = async (req) => {...}; serve(handler);`) to make it unit-testable. Apply the same `export const handler` pattern in Tasks 9 and 10. Full DB-backed happy-path coverage lives in the DB/Playwright layers; the edge unit tests assert auth/validation/branching with the Supabase client mocked at the `fetch` layer where needed.

- [ ] **Step 2: Run to verify it fails**

Run: `deno test -A --config supabase/functions/deno.json supabase/functions/recipe-chat-send/_test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { z } from 'zod';
import { HttpError, corsHeaders, jsonResponse, resolveCaller } from '../_shared/auth.ts';
import { env } from '../_shared/env.ts';
import { withRateBudget } from '../_shared/ai/rate-budget.ts';
import { createSession, sendUserMessage } from '../_shared/agents/transport.ts';

const Body = z.object({
  chat_session_id: z.string().uuid().optional(),
  message: z.string().min(1).max(4000),
  household_id: z.string().uuid(),
});

export const handler = async (req: Request): Promise<Response> => {
  const cors = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  try {
    const caller = await resolveCaller(req);
    const body = Body.parse(await req.json());

    const budget = await withRateBudget(caller.profileId, 4000, async () => true);
    if (budget.status === 'rate_limit') {
      return jsonResponse({ error: 'rate_limit', retry_after: 60 }, 429, cors);
    }

    let chatSessionId = body.chat_session_id;
    if (!chatSessionId) {
      const session = await createSession({
        agentId: env.RECIPE_AGENT_ID,
        environmentId: env.RECIPE_ENV_ID,
        title: body.message.slice(0, 80),
      });
      const { data, error } = await caller.client
        .from('recipe_chat_sessions')
        .insert({
          household_id: body.household_id,
          created_by: caller.profileId,
          anthropic_session_id: session.id,
          status: 'running',
        })
        .select('id, anthropic_session_id')
        .single();
      if (error) throw new HttpError(403, 'cannot_create_session');
      chatSessionId = data.id as string;
      await sendUserMessage(data.anthropic_session_id as string, body.message);
    } else {
      const { data, error } = await caller.client
        .from('recipe_chat_sessions')
        .select('anthropic_session_id')
        .eq('id', chatSessionId)
        .single();
      if (error || !data) throw new HttpError(404, 'session_not_found');
      await sendUserMessage(data.anthropic_session_id as string, body.message);
    }

    await caller.client.from('recipe_chat_messages').insert({
      chat_session_id: chatSessionId, role: 'user', content: body.message,
    });

    return jsonResponse({ chat_session_id: chatSessionId }, 200, cors);
  } catch (e) {
    if (e instanceof HttpError) {
      const res = e.toResponse();
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    }
    return jsonResponse({ error: 'internal' }, 500, cors);
  }
};

serve(handler);
```

- [ ] **Step 4: Run to verify it passes**

Run: `deno test -A --config supabase/functions/deno.json supabase/functions/recipe-chat-send/_test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/recipe-chat-send
git commit -m "feat(edge): recipe-chat-send function"
```

### Task 9: `recipe-chat-webhook`

**Files:**
- Create: `supabase/functions/recipe-chat-webhook/index.ts`
- Test: `supabase/functions/recipe-chat-webhook/_test.ts`

Responsibilities: verify HMAC; on `session.status_run_started` set status running; on `session.status_idled` fetch events past the cursor, resolve pending `agent.custom_tool_use` (list_my_recipes / get_recipe via a **service-role** client filtered by the session's `household_id`; present_draft via `validateDraft` → store `current_draft` + insert agent message, bounded by `draft_repair_attempts`), insert `agent.message` text, advance `events_cursor`, set status idle; on `session.status_terminated` set status error.

- [ ] **Step 1: Write the failing test**

```ts
import { assertEquals } from 'jsr:@std/assert';

Deno.env.set('SUPABASE_URL', 'https://test.supabase.co');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-role');
Deno.env.set('ANTHROPIC_API_KEY', 'test-key');
Deno.env.set('ANTHROPIC_WEBHOOK_SIGNING_KEY', 'whsec_dGVzdA=='); // base64("test")

Deno.test('webhook rejects an unsigned request with 400', async () => {
  const { handler } = await import('./index.ts');
  const res = await handler(new Request('http://localhost', {
    method: 'POST', body: JSON.stringify({ type: 'event', id: 'e1', data: {} }),
  }));
  assertEquals(res.status, 400);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test -A --config supabase/functions/deno.json supabase/functions/recipe-chat-webhook/_test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { env } from '../_shared/env.ts';
import { verifyWebhook } from '../_shared/agents/webhook.ts';
import { listEvents, sendToolResult } from '../_shared/agents/transport.ts';
import { getRecipe, listMyRecipes, validateDraft } from '../_shared/agents/recipe-tools.ts';

function admin() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }, db: { schema: 'app' },
  });
}

export const handler = async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return new Response('method', { status: 405 });
  const raw = await req.text();
  const ok = await verifyWebhook(env.ANTHROPIC_WEBHOOK_SIGNING_KEY, raw, {
    'webhook-id': req.headers.get('webhook-id') ?? undefined,
    'webhook-timestamp': req.headers.get('webhook-timestamp') ?? undefined,
    'webhook-signature': req.headers.get('webhook-signature') ?? undefined,
  });
  if (!ok) return new Response('invalid signature', { status: 400 });

  const event = JSON.parse(raw) as { data?: { type?: string; id?: string } };
  const type = event.data?.type;
  const anthropicSessionId = event.data?.id;
  if (!anthropicSessionId) return new Response(null, { status: 204 });

  const db = admin();
  const { data: session } = await db
    .from('recipe_chat_sessions')
    .select('id, household_id, anthropic_session_id, events_cursor, draft_repair_attempts')
    .eq('anthropic_session_id', anthropicSessionId)
    .single();
  if (!session) return new Response(null, { status: 204 }); // not ours

  if (type === 'session.status_run_started') {
    await db.from('recipe_chat_sessions').update({ status: 'running' }).eq('id', session.id);
    return new Response(null, { status: 204 });
  }
  if (type === 'session.status_terminated') {
    await db.from('recipe_chat_sessions').update({ status: 'error' }).eq('id', session.id);
    await db.from('recipe_chat_messages').insert({
      chat_session_id: session.id, role: 'agent',
      content: 'Something went wrong with this draft. Please start a new one.',
    });
    return new Response(null, { status: 204 });
  }
  if (type !== 'session.status_idled') return new Response(null, { status: 204 });

  // Drain new events past the cursor.
  const events = await listEvents(anthropicSessionId);
  const cursor = session.events_cursor as string | null;
  const startIdx = cursor ? events.findIndex((e) => e.id === cursor) + 1 : 0;
  const fresh = events.slice(startIdx);
  let repairAttempts = session.draft_repair_attempts as number;
  let lastId = cursor;

  for (const ev of fresh) {
    lastId = ev.id;
    if (ev.type === 'agent.custom_tool_use') {
      try {
        if (ev.name === 'list_my_recipes') {
          const out = await listMyRecipes(db as never, session.household_id as string, ev.input ?? {});
          await sendToolResult(anthropicSessionId, ev.id, out);
        } else if (ev.name === 'get_recipe') {
          const out = await getRecipe(db as never, session.household_id as string,
            String((ev.input ?? {}).recipe_id ?? ''));
          await sendToolResult(anthropicSessionId, ev.id, out);
        } else if (ev.name === 'present_draft') {
          const v = validateDraft(ev.input);
          if (v.ok) {
            await db.from('recipe_chat_sessions')
              .update({ current_draft: v.recipe, draft_repair_attempts: 0 })
              .eq('id', session.id);
            await sendToolResult(anthropicSessionId, ev.id, { ok: true });
          } else if (repairAttempts < 2) {
            repairAttempts += 1;
            await db.from('recipe_chat_sessions')
              .update({ draft_repair_attempts: repairAttempts }).eq('id', session.id);
            await sendToolResult(anthropicSessionId, ev.id,
              { ok: false, errors: v.errors }, true);
          } else {
            await sendToolResult(anthropicSessionId, ev.id,
              { ok: false, errors: ['too many invalid drafts'] }, true);
            await db.from('recipe_chat_messages').insert({
              chat_session_id: session.id, role: 'agent',
              content: "I couldn't produce a valid recipe. Could you adjust what you're after?",
            });
          }
        } else {
          await sendToolResult(anthropicSessionId, ev.id, { error: 'unknown tool' }, true);
        }
      } catch (_e) {
        await sendToolResult(anthropicSessionId, ev.id, { error: 'tool failed' }, true);
      }
    } else if (ev.type === 'agent.message') {
      const text = (ev.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      if (text.trim()) {
        await db.from('recipe_chat_messages').insert({
          chat_session_id: session.id, role: 'agent', content: text,
        });
      }
    }
  }

  await db.from('recipe_chat_sessions')
    .update({ status: 'idle', events_cursor: lastId }).eq('id', session.id);
  return new Response(null, { status: 204 });
};

serve(handler);
```

- [ ] **Step 4: Run to verify it passes**

Run: `deno test -A --config supabase/functions/deno.json supabase/functions/recipe-chat-webhook/_test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/recipe-chat-webhook
git commit -m "feat(edge): recipe-chat-webhook (tool execution + draft validation)"
```

### Task 10: `recipe-chat-save`

**Files:**
- Create: `supabase/functions/recipe-chat-save/index.ts`
- Test: `supabase/functions/recipe-chat-save/_test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { assertEquals } from 'jsr:@std/assert';

Deno.env.set('SUPABASE_URL', 'https://test.supabase.co');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-role');
Deno.env.set('ANTHROPIC_API_KEY', 'test-key');

Deno.test('recipe-chat-save requires auth', async () => {
  const { handler } = await import('./index.ts');
  const res = await handler(new Request('http://localhost', {
    method: 'POST', body: JSON.stringify({ chat_session_id: crypto.randomUUID() }),
  }));
  assertEquals(res.status, 401);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test -A --config supabase/functions/deno.json supabase/functions/recipe-chat-save/_test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { z } from 'zod';
import { HttpError, corsHeaders, jsonResponse, resolveCaller } from '../_shared/auth.ts';
import { archiveSession } from '../_shared/agents/transport.ts';

const Body = z.object({ chat_session_id: z.string().uuid() });

export const handler = async (req: Request): Promise<Response> => {
  const cors = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  try {
    const caller = await resolveCaller(req);
    const body = Body.parse(await req.json());

    const { data: session, error } = await caller.client
      .from('recipe_chat_sessions')
      .select('id, household_id, anthropic_session_id, current_draft, recipe_id')
      .eq('id', body.chat_session_id)
      .single();
    if (error || !session) throw new HttpError(404, 'session_not_found');
    if (!session.current_draft) throw new HttpError(409, 'no_draft');
    if (session.recipe_id) {
      return jsonResponse({ recipe_id: session.recipe_id }, 200, cors); // idempotent
    }

    const { data: recipeId, error: saveErr } = await caller.client.rpc('save_recipe', {
      p_household: session.household_id,
      p_draft: session.current_draft as never,
    });
    if (saveErr) throw new HttpError(400, 'save_failed');

    await caller.client.from('recipe_chat_sessions')
      .update({ status: 'saved', recipe_id: recipeId }).eq('id', session.id);
    try { await archiveSession(session.anthropic_session_id as string); } catch { /* best-effort */ }

    return jsonResponse({ recipe_id: recipeId }, 200, cors);
  } catch (e) {
    if (e instanceof HttpError) {
      const res = e.toResponse();
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    }
    return jsonResponse({ error: 'internal' }, 500, cors);
  }
};

serve(handler);
```

- [ ] **Step 4: Run to verify it passes**

Run: `deno test -A --config supabase/functions/deno.json supabase/functions/recipe-chat-save/_test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full edge suite + commit**

Run: `pnpm test:edge`
Expected: all edge tests pass.

```bash
git add supabase/functions/recipe-chat-save
git commit -m "feat(edge): recipe-chat-save (save_recipe + archive session)"
```

---

## Phase 4 — One-time control-plane setup (owner runs with their key)

### Task 11: Setup script + runbook

**Files:**
- Create: `scripts/managed-agents/setup.ts`
- Create: `docs/runbooks/recipe-chat-setup.md`

- [ ] **Step 1: Write the setup script**

```ts
// One-time: create the Environment + Agent and print their IDs.
// Run: ANTHROPIC_API_KEY=sk-ant-... deno run -A scripts/managed-agents/setup.ts
import {
  RECIPE_AGENT_MODEL, RECIPE_AGENT_SYSTEM, RECIPE_AGENT_TOOLS, MANAGED_AGENTS_BETA,
} from '../../supabase/functions/_shared/agents/config.ts';

const KEY = Deno.env.get('ANTHROPIC_API_KEY');
if (!KEY) { console.error('Set ANTHROPIC_API_KEY'); Deno.exit(1); }

const headers = {
  'x-api-key': KEY, 'anthropic-version': '2023-06-01',
  'anthropic-beta': MANAGED_AGENTS_BETA, 'content-type': 'application/json',
};

async function post(path: string, body: unknown) {
  const res = await fetch(`https://api.anthropic.com${path}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  if (!res.ok) { console.error(path, res.status, await res.text()); Deno.exit(1); }
  return res.json();
}

const env = await post('/v1/environments', {
  name: `dishton-recipe-drafter-${Date.now()}`,
  config: { type: 'cloud', networking: { type: 'limited' } },
});
const agent = await post('/v1/agents', {
  name: 'Dishton Recipe Drafter',
  model: RECIPE_AGENT_MODEL,
  system: RECIPE_AGENT_SYSTEM,
  tools: RECIPE_AGENT_TOOLS,
});

console.log('\nSet these as Supabase secrets:');
console.log(`  RECIPE_ENV_ID=${env.id}`);
console.log(`  RECIPE_AGENT_ID=${agent.id}`);
```

- [ ] **Step 2: Typecheck the script**

Run: `deno check scripts/managed-agents/setup.ts`
Expected: no errors.

- [ ] **Step 3: Write the runbook** (`docs/runbooks/recipe-chat-setup.md`)

Document exactly: (1) `deno run -A scripts/managed-agents/setup.ts` with the key; (2) `supabase secrets set RECIPE_AGENT_ID=… RECIPE_ENV_ID=… ANTHROPIC_WEBHOOK_SIGNING_KEY=whsec_…`; (3) `pnpm fn:deploy` to deploy the three functions; (4) in the Anthropic Console → Webhooks, register the deployed `recipe-chat-webhook` URL for `session.status_run_started`, `session.status_idled`, `session.status_terminated`, and copy its `whsec_` secret into step 2; (5) note local dev needs a tunnel (cloudflared) to receive webhooks, or use `AI_MOCK_MODE=1`.

- [ ] **Step 4: Commit**

```bash
git add scripts/managed-agents/setup.ts docs/runbooks/recipe-chat-setup.md
git commit -m "feat(agents): one-time setup script + runbook"
```

---

## Phase 5 — SPA

### Task 12: i18n strings

**Files:**
- Modify: `src/lib/i18n.en.ts` and `src/lib/i18n.de.ts`

- [ ] **Step 1: Add a `chat` group to both locale files**

In `i18n.en.ts`, add a top-level group:

```ts
  chat: {
    nav: 'Draft with AI',
    title: 'Draft a recipe',
    placeholder: 'Describe the vibe and any ingredients…',
    send: 'Send',
    thinking: 'Drafting…',
    draft_heading: 'Draft',
    no_draft_yet: 'Your draft will appear here as we chat.',
    save: 'Save to pantry',
    saved_toast: "It's in your pantry now.",
    save_error: "Couldn't save the recipe. Please try again.",
    view_draft: 'View draft',
    view_chat: 'Back to chat',
  },
```

Add the German equivalents in `i18n.de.ts` with the same keys.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors (the `as const` locale objects stay structurally aligned).

- [ ] **Step 3: Commit**

```bash
git add src/lib/i18n.en.ts src/lib/i18n.de.ts
git commit -m "feat(i18n): recipe chat strings"
```

### Task 13: `useRecipeChat` hook

**Files:**
- Create: `src/lib/queries/recipe-chat.ts`

Provides: initial load of messages + session (TanStack Query), Realtime subscriptions to `recipe_chat_messages` (insert) and the `recipe_chat_sessions` row (update → `current_draft`/`status`), and `sendMessage` / `save` callers. Mirrors `ActiveImportsProvider`'s channel pattern and `recipes.ts` query style. (Query hooks are excluded from unit-coverage by config; covered via Playwright.)

- [ ] **Step 1: Implement**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '../supabase';
import type { Recipe } from '@/domain';

export type ChatMessage = { id: string; role: 'user' | 'agent'; content: string; created_at: string };
export type ChatSession = { id: string; status: string; current_draft: Recipe | null; recipe_id: string | null };

export function useChatMessages(chatSessionId: string | null) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['recipe-chat-messages', chatSessionId],
    enabled: !!chatSessionId,
    queryFn: async (): Promise<ChatMessage[]> => {
      const { data, error } = await supabase
        .from('recipe_chat_messages').select('id, role, content, created_at')
        .eq('chat_session_id', chatSessionId).order('created_at');
      if (error) throw error;
      return (data ?? []) as ChatMessage[];
    },
  });
  useEffect(() => {
    if (!chatSessionId) return;
    const channel = supabase
      .channel(`recipe_chat_messages:${chatSessionId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'app', table: 'recipe_chat_messages',
          filter: `chat_session_id=eq.${chatSessionId}` },
        () => { void qc.invalidateQueries({ queryKey: ['recipe-chat-messages', chatSessionId] }); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [chatSessionId, qc]);
  return query;
}

export function useChatSession(chatSessionId: string | null) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['recipe-chat-session', chatSessionId],
    enabled: !!chatSessionId,
    queryFn: async (): Promise<ChatSession> => {
      const { data, error } = await supabase
        .from('recipe_chat_sessions').select('id, status, current_draft, recipe_id')
        .eq('id', chatSessionId).single();
      if (error) throw error;
      return data as ChatSession;
    },
  });
  useEffect(() => {
    if (!chatSessionId) return;
    const channel = supabase
      .channel(`recipe_chat_session:${chatSessionId}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'app', table: 'recipe_chat_sessions',
          filter: `id=eq.${chatSessionId}` },
        () => { void qc.invalidateQueries({ queryKey: ['recipe-chat-session', chatSessionId] }); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [chatSessionId, qc]);
  return query;
}

export function useSendChatMessage(householdId: string) {
  return useMutation({
    mutationFn: async (args: { chatSessionId: string | null; message: string }): Promise<string> => {
      const { data, error } = await supabase.functions.invoke('recipe-chat-send', {
        body: { chat_session_id: args.chatSessionId ?? undefined, message: args.message, household_id: householdId },
      });
      if (error) throw error;
      return (data as { chat_session_id: string }).chat_session_id;
    },
  });
}

export function useSaveDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (chatSessionId: string): Promise<string> => {
      const { data, error } = await supabase.functions.invoke('recipe-chat-save', {
        body: { chat_session_id: chatSessionId },
      });
      if (error) throw error;
      return (data as { recipe_id: string }).recipe_id;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['recipes'] }); },
  });
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm typecheck`
Expected: no errors.

```bash
git add src/lib/queries/recipe-chat.ts
git commit -m "feat(spa): useRecipeChat queries + realtime"
```

### Task 14: Draft preview card

**Files:**
- Create: `src/ui/recipe/DraftPreviewCard.tsx`
- Test: `src/ui/recipe/DraftPreviewCard.test.tsx`

Renders a `Recipe` draft using the same visual language as the recipe detail page. Reuses `IngredientsCard` by mapping draft ingredients to its `DisplayIngredient[]` shape and passing `formatNumber`/`formatDisplayQuantity` from `@/domain`; copies the inline title/description/tags/steps JSX from `RecipeDetailPage`.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import { DraftPreviewCard } from './DraftPreviewCard';

const draft = {
  title: 'Saffron Risotto', description: 'Creamy.', source_type: 'manual', source_url: null,
  source_language: 'en', canonical_unit_system: 'metric', servings: 2, total_time_min: 40,
  hero_image_path: null, tags: ['rice'],
  ingredients: [{ position: 0, raw_text: '200g rice', quantity: 200, unit: 'g',
    ingredient_name: 'rice', notes: null, scalable: true, non_scalable_qty: null, section: null }],
  steps: [{ position: 0, body: 'Toast the rice.', duration_min: 5 }],
} as const;

describe('DraftPreviewCard', () => {
  it('renders the draft title and a step', () => {
    render(<DraftPreviewCard draft={draft as never} />);
    expect(screen.getByText('Saffron Risotto')).toBeInTheDocument();
    expect(screen.getByText('Toast the rice.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/ui/recipe/DraftPreviewCard.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```tsx
import { useTranslation } from 'react-i18next';
import type { Recipe } from '@/domain';
import { formatNumber, formatDisplayQuantity } from '@/domain';
import { Badge } from '@/ui/primitives/Badge';
import { IngredientsCard, type DisplayIngredient } from '@/ui/recipe/IngredientsCard';

export function DraftPreviewCard({ draft }: { draft: Recipe }) {
  const { t } = useTranslation();
  const ingredients: DisplayIngredient[] = draft.ingredients.map((ing) => ({
    ...ing,
    id: `draft-${ing.position}`,
    recipe_id: 'draft',
    displayQuantity: typeof ing.quantity === 'number' || ing.quantity == null ? ing.quantity : ing.quantity,
    displayUnit: ing.unit,
  })) as unknown as DisplayIngredient[];

  return (
    <div className="space-y-6">
      {draft.tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {draft.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
        </div>
      )}
      <h2 className="font-display text-2xl leading-tight">{draft.title}</h2>
      {draft.description && (
        <p className="text-ink-soft leading-relaxed max-w-prose">{draft.description}</p>
      )}
      <IngredientsCard
        ingredients={ingredients}
        formatDecimal={formatNumber}
        formatDisplayQuantity={formatDisplayQuantity}
      />
      <section>
        <h3 className="font-display text-xl mb-4">{t('recipe.steps')}</h3>
        <ol className="space-y-6">
          {draft.steps.map((s) => (
            <li key={s.position} className="grid grid-cols-[2.5rem_1fr] gap-4">
              <span className="font-mono text-2xl tabular-nums text-saffron">{s.position + 1}</span>
              <p className="leading-relaxed">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
```

> If `IngredientsCard`'s exact `DisplayIngredient` fields differ from the mapping above, open `src/ui/recipe/IngredientsCard.tsx` and align the mapped object to its real shape (the card reads `raw_text`, `displayQuantity`, `displayUnit`, `section`, `ingredient_name`). Keep formatters from `@/domain`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/ui/recipe/DraftPreviewCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/recipe/DraftPreviewCard.tsx src/ui/recipe/DraftPreviewCard.test.tsx
git commit -m "feat(spa): draft preview card"
```

### Task 15: Chat thread + composer

**Files:**
- Create: `src/ui/recipe/chat/ChatThread.tsx`
- Test: `src/ui/recipe/chat/ChatThread.test.tsx`
- Create: `src/ui/recipe/chat/ChatComposer.tsx`

- [ ] **Step 1: Write the failing test for ChatThread**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChatThread } from './ChatThread';

describe('ChatThread', () => {
  it('renders user and agent messages in order', () => {
    render(<ChatThread messages={[
      { id: '1', role: 'user', content: 'cozy autumn soup', created_at: '' },
      { id: '2', role: 'agent', content: 'How about a squash soup?', created_at: '' },
    ]} thinking={false} />);
    expect(screen.getByText('cozy autumn soup')).toBeInTheDocument();
    expect(screen.getByText('How about a squash soup?')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/ui/recipe/chat/ChatThread.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement ChatThread and ChatComposer**

`ChatThread.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import type { ChatMessage } from '@/lib/queries/recipe-chat';

export function ChatThread({ messages, thinking }: { messages: ChatMessage[]; thinking: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      {messages.map((m) => (
        <div key={m.id}
          className={m.role === 'user'
            ? 'self-end max-w-[85%] rounded-2xl bg-saffron/15 px-4 py-2'
            : 'self-start max-w-[85%] rounded-2xl bg-ink/5 px-4 py-2'}>
          <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
        </div>
      ))}
      {thinking && <p className="self-start text-ink-soft text-sm italic">{t('chat.thinking')}</p>}
    </div>
  );
}
```

`ChatComposer.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/primitives/Button';

export function ChatComposer({ onSend, disabled }: { onSend: (text: string) => void; disabled: boolean }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  return (
    <form className="flex gap-2"
      onSubmit={(e) => { e.preventDefault(); if (text.trim()) { onSend(text.trim()); setText(''); } }}>
      <textarea
        className="flex-1 resize-none rounded-xl border border-ink/15 px-3 py-2"
        rows={2} value={text} placeholder={t('chat.placeholder')}
        onChange={(e) => setText(e.target.value)} aria-label={t('chat.placeholder')} />
      <Button type="submit" disabled={disabled || !text.trim()}>{t('chat.send')}</Button>
    </form>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/ui/recipe/chat/ChatThread.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/recipe/chat
git commit -m "feat(spa): chat thread + composer"
```

### Task 16: Route wiring

**Files:**
- Create: `src/routes/h/$householdId/draft.tsx`

Two-pane on desktop, toggle on mobile. Uses `requireAuth`, the hooks from Task 13, and the components from Tasks 14-15.

- [ ] **Step 1: Implement the route**

```tsx
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { requireAuth } from '../../_guards';
import { Button } from '@/ui/primitives/Button';
import { useToast } from '@/ui/primitives/Toast';
import { ChatThread } from '@/ui/recipe/chat/ChatThread';
import { ChatComposer } from '@/ui/recipe/chat/ChatComposer';
import { DraftPreviewCard } from '@/ui/recipe/DraftPreviewCard';
import {
  useChatMessages, useChatSession, useSaveDraft, useSendChatMessage,
} from '@/lib/queries/recipe-chat';

export const Route = createFileRoute('/h/$householdId/draft')({
  beforeLoad: requireAuth,
  component: DraftPage,
});

function DraftPage() {
  const { householdId } = Route.useParams();
  const { t } = useTranslation();
  const navigate = useNavigate({ from: Route.fullPath });
  const { push } = useToast();
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<'chat' | 'draft'>('chat');

  const messages = useChatMessages(chatSessionId);
  const session = useChatSession(chatSessionId);
  const send = useSendChatMessage(householdId);
  const save = useSaveDraft();

  const draft = session.data?.current_draft ?? null;
  const thinking = session.data?.status === 'running' || send.isPending;

  const onSend = (text: string) => {
    send.mutate({ chatSessionId, message: text }, {
      onSuccess: (id) => setChatSessionId(id),
      onError: () => push({ variant: 'error', title: t('chat.save_error') }),
    });
  };

  const onSave = () => {
    if (!chatSessionId) return;
    save.mutate(chatSessionId, {
      onSuccess: (recipeId) => {
        push({ variant: 'success', title: t('chat.saved_toast') });
        void navigate({ to: '/h/$householdId/r/$recipeId', params: { householdId, recipeId } });
      },
      onError: () => push({ variant: 'error', title: t('chat.save_error') }),
    });
  };

  return (
    <div className="mx-auto max-w-6xl p-4">
      <h1 className="font-display text-3xl mb-4">{t('chat.title')}</h1>
      <div className="md:hidden mb-3 flex gap-2">
        <Button variant={mobileView === 'chat' ? 'default' : 'outline'} onClick={() => setMobileView('chat')}>{t('chat.view_chat')}</Button>
        <Button variant={mobileView === 'draft' ? 'default' : 'outline'} onClick={() => setMobileView('draft')}>{t('chat.view_draft')}</Button>
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <div className={`${mobileView === 'chat' ? 'block' : 'hidden'} md:block flex flex-col gap-4`}>
          <div className="min-h-[40vh]"><ChatThread messages={messages.data ?? []} thinking={thinking} /></div>
          <ChatComposer onSend={onSend} disabled={send.isPending} />
        </div>
        <div className={`${mobileView === 'draft' ? 'block' : 'hidden'} md:block`}>
          <h2 className="font-display text-xl mb-2">{t('chat.draft_heading')}</h2>
          {draft ? <DraftPreviewCard draft={draft} /> : <p className="text-ink-soft">{t('chat.no_draft_yet')}</p>}
          <Button className="mt-6 w-full" disabled={!draft || save.isPending} onClick={onSave}>{t('chat.save')}</Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Regenerate the route tree + typecheck**

Run: `pnpm typecheck`
Expected: no errors (the route tree regenerates on dev/build; if a check complains, run `pnpm dev` once or the project's route-gen step). Do not hand-edit `src/routeTree.gen.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/routes/h/$householdId/draft.tsx src/routeTree.gen.ts
git commit -m "feat(spa): recipe draft chat route"
```

### Task 17: Entry points

**Files:**
- Modify: `src/routes/h/$householdId/index.tsx`
- Modify: `src/ui/shell/AppShell.tsx`

- [ ] **Step 1: Add the header button on the recipe list**

In `index.tsx`, beside the existing import `<Link>` (the header action), add:

```tsx
        <Link to="/h/$householdId/draft" params={{ householdId }}>
          <Button variant="outline">{t('chat.nav')}</Button>
        </Link>
```

- [ ] **Step 2: Add the nav entry in AppShell**

In `AppShell.tsx`, mirror the existing import `<li>` block (the `{householdId && (...)}` nav item), adding a sibling linking to `/h/$householdId/draft` with the `chat.nav` label and a `lucide-react` icon (e.g. `Sparkles`).

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm typecheck`
Expected: no errors.

```bash
git add src/routes/h/$householdId/index.tsx src/ui/shell/AppShell.tsx
git commit -m "feat(spa): entry points for draft-with-AI"
```

---

## Phase 6 — Verification

### Task 18: Full local verification

- [ ] **Step 1: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 2: All test suites**

Run: `pnpm test:unit && pnpm test:components && pnpm test:edge && pnpm test:db`
Expected: all pass.

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: succeeds.

### Task 19: Visual validation (mock mode)

Because no Anthropic key is available locally, run the flow with `AI_MOCK_MODE=1` so the agent transport returns canned responses. Extend the mock path in `transport.ts` (or a Playwright fixture) so that, in mock mode, a send produces a deterministic agent message + a valid `present_draft` written to the session row, exercising the Realtime → preview-card → Save path end-to-end.

- [ ] **Step 1: Invoke the visual-validation skill**

Use the `validating-features-visually` skill (per CLAUDE.md) to drive Playwright through: signup → open "Draft with AI" → send a vibe → see an agent reply + draft card → Save → land on the saved recipe. Capture desktop + mobile screenshots; check for mobile overflow on the two-pane/toggle layout.

- [ ] **Step 2: Create the e2e spec**

Create `e2e/recipe-chat.spec.ts` following the existing Playwright specs, asserting the draft card appears and Save navigates to the recipe.

- [ ] **Step 3: Commit**

```bash
git add e2e/recipe-chat.spec.ts
git commit -m "test(e2e): recipe chat draft-and-save flow"
```

---

## Manual steps (owner, with Anthropic key) — not implementable here

1. `ANTHROPIC_API_KEY=… deno run -A scripts/managed-agents/setup.ts` → capture `RECIPE_ENV_ID`, `RECIPE_AGENT_ID`.
2. `supabase secrets set RECIPE_AGENT_ID=… RECIPE_ENV_ID=… ANTHROPIC_WEBHOOK_SIGNING_KEY=whsec_…`.
3. `pnpm fn:deploy` (deploys the three new functions).
4. Anthropic Console → Webhooks → register the deployed `recipe-chat-webhook` URL for `session.status_run_started`, `session.status_idled`, `session.status_terminated`; paste its `whsec_` secret into step 2.
5. Verify against the deployed project (webhooks need a public URL; local dev uses a tunnel or `AI_MOCK_MODE`).

## Self-review notes

- Every spec section (§4–§13) maps to a task: architecture/flow → Tasks 8–10; agent config → Task 4; tools → Tasks 4/7/9; edge functions → 8–10; data model → 1–2; SPA → 12–17; validation/repair → 7/9; cost guardrails → 8 (budget) + 4 (model/effort) + 10 (archive); errors → 9/10; testing → 2,5,6,7,8,9,10,14,15,18,19; setup → 11.
- Type consistency: `validateDraft`, `listMyRecipes`, `getRecipe` defined in Task 7 are consumed in Task 9; `createSession`/`sendUserMessage`/`sendToolResult`/`listEvents`/`archiveSession` defined in Task 5 are consumed in Tasks 8–10; `useChatMessages`/`useChatSession`/`useSendChatMessage`/`useSaveDraft` defined in Task 13 are consumed in Task 16; `DraftPreviewCard`/`ChatThread`/`ChatComposer` defined in Tasks 14–15 consumed in Task 16.
- Known follow-ups (out of scope): stale-session reaper; memory store; streaming; in-card editing.
