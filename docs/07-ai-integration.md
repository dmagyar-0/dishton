# 07 — AI Integration (Anthropic Claude Haiku 4.5)

## Purpose

Specify the server-side Anthropic client used by every Edge Function: how it
authenticates, retries, validates output against the canonical Recipe Zod
schema, gates calls behind the rate budget, and logs cost. This doc owns the
Anthropic-facing surface; the import flows that consume it are in
[08-import-pipelines.md](./08-import-pipelines.md). The Anthropic API key
never leaves the Edge Function process.

## Prerequisites

- [00-overview.md](./00-overview.md) — locked AI provider and key location.
- [01-architecture.md](./01-architecture.md) — Edge Function topology and env vars.
- [04-data-model.md](./04-data-model.md) — `app.import_jobs`, `app.ai_rate_budget`.
- [06-recipe-domain.md](./06-recipe-domain.md) — `Recipe` Zod schema (the
  contract every prompt enforces).

## Folder layout

```
/home/user/dishton/supabase/functions/
  _shared/
    ai/
      client.ts          — Anthropic client wrapper
      prompts.ts         — typed prompt templates
      rate-budget.ts     — withRateBudget(estimate, fn)
      validate.ts        — Zod-bridge + re-prompt-once helper
      _test.ts           — RECIPE_JSON_SHAPE parity test
    domain/              — symlink to /home/user/dishton/src/domain
    env.ts               — typed env loader
    log.ts               — structured log lines (logAiCall lives here)
```

The `domain` symlink lets Edge Functions import from `_shared/domain/recipe.ts`
which resolves to the real file under `src/domain/`. This makes the Recipe
schema literally the same module on both sides.

## Anthropic client

```ts
// supabase/functions/_shared/ai/client.ts
import Anthropic from 'npm:@anthropic-ai/sdk@^0.40.0';
import { env } from '../env.ts';

export type Lane = 'text' | 'vision';

const DEFAULT_MODEL = 'claude-haiku-4-5';
const MAX_OUTPUT_TOKENS = 4096;
const TIMEOUT_MS: Record<Lane, number> = { text: 90_000, vision: 90_000 };
const MAX_RETRIES = 3;
const BACKOFF_MS = [1_000, 2_000, 4_000];

const client = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
  maxRetries: 0,    // our retry loop is the single source of truth
});

export async function aiChat(opts: AiCallOpts): Promise<AiResult> {
  const model = opts.model ?? env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const { system, rest } = splitSystem(opts.messages);

  // ... retry loop with timeout + jitter ...
  const resp = await client.messages.create({
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system,                      // [{type:'text', text, cache_control:{type:'ephemeral'}}]
    messages: rest,
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
  }, { signal: ac.signal });

  const text = resp.content.map((b) => b.type === 'text' ? b.text : '').join('');
  return {
    content: text,
    usage: {
      input: resp.usage.input_tokens,
      output: resp.usage.output_tokens,
      cache_read: resp.usage.cache_read_input_tokens,
      cache_write: resp.usage.cache_creation_input_tokens,
    },
    model: resp.model,
  };
}
```

Notes:

- **Single model for both lanes.** Claude Haiku 4.5 is vision-capable, so the
  `lane: 'text' | 'vision'` parameter no longer selects a model — it stays as
  a budget/timeout hint. `ANTHROPIC_MODEL` env var overrides the default for
  experimentation; production runs `claude-haiku-4-5`.
- **No `effort` / `thinking`.** Haiku 4.5 does not support `effort`; using it
  returns 400. Adaptive thinking is also unnecessary for structured
  extraction. Keep the call shape simple.
- **Prompt caching.** The system block — which carries the large, stable
  `RECIPE_JSON_SHAPE` preamble — is sent as a `TextBlockParam` with
  `cache_control: {type: 'ephemeral'}`. After the first request in a lane,
  the preamble serves from cache (≈90% input cost savings on the cached
  portion). Verify via `usage.cache_read_input_tokens > 0`.
- **Temperature.** Defaults to Anthropic's default (1.0). Translation prompts
  pass `temperature: 0.2` explicitly when calling. Structuring relies on
  prompt-driven JSON shape rather than low-temperature determinism.
- **Retry policy.** Retries on `Anthropic.RateLimitError`,
  `Anthropic.InternalServerError`, `Anthropic.APIConnectionError`, and
  `Anthropic.APIError` with status >= 500 or status == 429. All other 4xx
  surface immediately. SDK retries are disabled (`maxRetries: 0`) so the
  3-attempt 1s/2s/4s + jitter loop is the only retry path observable in logs.

## Prompts

`prompts.ts` exports four template functions. Each returns the full
`AiMessage[]` array — including a leading `role: 'system'` message that the
client extracts and converts to Anthropic's top-level `system` parameter
with cache_control. The Recipe schema is described inline as
`RECIPE_JSON_SHAPE` so the model sees the exact field shape.

```ts
// supabase/functions/_shared/ai/prompts.ts
import type { AiMessage } from './client.ts';

export const RECIPE_JSON_SHAPE = `
The JSON object MUST match this TypeScript type exactly:
{
  "title": string,
  ...
}

Rules:
- Output ONLY a single JSON object. No prose, no code fences, no commentary.
- "cup" defaults to "cup_us" (240 ml). For European-language sources, use "cup_metric" (250 ml).
- Preserve the source language verbatim; do NOT translate.
- Canonical unit keys: g, kg, oz, lb, ml, l, tsp, tbsp, cup_us, cup_metric, fl_oz, count, C, F, min, h.
`.trim();

export function structuringFromHtml(args: {
  html: string; sourceUrl: string; hint?: string;
}): AiMessage[] { /* role:'system' with RECIPE_JSON_SHAPE, role:'user' with HTML */ }

export function structuringFromCaption(args: {
  caption: string; sourceUrl: string;
}): AiMessage[] { /* role:'system' with RECIPE_JSON_SHAPE, role:'user' with caption */ }

export function structuringFromImage(args: { imageUrl: string }): AiMessage[] {
  return [
    { role: 'system', content: `You read recipes... ${RECIPE_JSON_SHAPE}` },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Extract the recipe in this image. ...' },
        { type: 'image', source: { type: 'url', url: args.imageUrl } },
      ],
    },
  ];
}

export function translatePrompt(args: {
  recipeJson: string; targetLanguage: string;
}): AiMessage[] { /* role:'system' translation rules, role:'user' recipe JSON */ }
```

The `RECIPE_JSON_SHAPE` constant is asserted by a parity test in `_test.ts`
(see [12-testing-strategy.md](./12-testing-strategy.md)) which checks that
every field in the Zod `Recipe` schema is mentioned. This catches the case
of a future Recipe field being added but not advertised to the model.

## Validation pipeline

```ts
// supabase/functions/_shared/ai/validate.ts
import { Recipe } from '../domain/recipe.ts';
import { aiChat, type AiCallOpts, type AiResult } from './client.ts';

export type ValidationResult =
  | { ok: true; recipe: import('../domain/recipe.ts').Recipe;
      usage: AiResult['usage']; model: string; raw: string }
  | { ok: false; reason: 'parse'|'schema'|'rate_limit'|'upstream'; raw: string };

export async function callAndValidate(opts: AiCallOpts): Promise<ValidationResult> {
  const first = await aiChat(opts);
  let parsed = tryParseJson(first.content);
  if (!parsed.ok) {
    // one re-prompt with the parse error
    const retry = await aiChat({
      ...opts,
      messages: [
        ...opts.messages,
        { role: 'assistant', content: first.content },
        { role: 'user', content:
          `Your previous response was not valid JSON: ${parsed.error}.
Return ONLY a single JSON object that matches the schema. No commentary.` },
      ],
    });
    parsed = tryParseJson(retry.content);
    if (!parsed.ok) return { ok: false, reason: 'parse', raw: retry.content };
    /* sum usage */
  }
  const safe = Recipe.safeParse(parsed.value);
  if (!safe.success) return { ok: false, reason: 'schema', raw: JSON.stringify(parsed.value) };
  return { ok: true, recipe: safe.data, usage: first.usage, model: first.model, raw: first.content };
}
```

If `ok: false` with reason `parse` or `schema`, the calling Edge Function:

1. writes the raw model output to `import_jobs.payload.raw_model_output`,
2. sets `import_jobs.status = 'needs_review'`,
3. returns the partial draft (or null) to the SPA so the user can edit
   manually.

## Rate budget

```ts
// supabase/functions/_shared/ai/rate-budget.ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { env } from '../env.ts';

const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

export async function withRateBudget<T>(
  estimatedTokens: number,
  fn: () => Promise<T>,
): Promise<{ status: 'ok' | 'rate_limit'; value?: T }> {
  const reserved = await admin.rpc('app_reserve_ai_budget', { p_tokens: estimatedTokens });
  if (reserved.error) throw reserved.error;
  if (reserved.data === false) return { status: 'rate_limit' };
  const value = await fn();
  return { status: 'ok', value };
}
```

The Postgres function does the atomic update (defined in the
`*_imports.sql` migration referenced in [04-data-model.md](./04-data-model.md));
`budget_per_minute` defaults to 60 000 tokens, tunable per environment.

`estimatedTokens` per lane:

| Lane | Estimate |
|---|---|
| URL structuring | 4 000 (HTML can be long) |
| Instagram structuring | 1 200 |
| Photo structuring | 3 500 |
| Translation | 2 500 |

After the call, the `payload.tokens_in` / `tokens_out` written to
`import_jobs` reflect actuals; the budget is not re-credited (over-estimation
is intentional safety margin).

## Cost / usage logging

Each Anthropic call appends a structured log line via `log.ts`:

```ts
// supabase/functions/_shared/log.ts
export function logAiCall(fields: {
  request_id: string;
  function: string;
  lane: 'text' | 'vision';
  model: string;        // resolved model id from the response (e.g. claude-haiku-4-5)
  ms: number;
  tokens_in: number;
  tokens_out: number;
  cache_read?: number;
  cache_write?: number;
  ok: boolean;
  reason?: string;
}): void {
  console.log(JSON.stringify({ kind: 'ai_call', ...fields }));
}
```

The aggregator picks these up via the log drain (see
[14-observability.md](./14-observability.md)). The `app.v_ai_daily_cost`
view aggregates them for the in-app dashboard.

## Mocking in tests

The shared `mock_fetch.ts` helper installs over `globalThis.fetch`. The
Anthropic SDK uses `fetch` internally so mocking that hook covers all
outbound traffic. Tests assert the request hits
`https://api.anthropic.com/v1/messages` and that the `x-api-key` header
carries the env key.

Local development can set `AI_MOCK_MODE=playwright` to read canned
responses from `e2e/fixtures/ai-*.json` instead of contacting Anthropic —
this is what the E2E smoke uses (see
[12-testing-strategy.md](./12-testing-strategy.md)).

## Files this doc governs

- `/home/user/dishton/supabase/functions/_shared/ai/client.ts`
- `/home/user/dishton/supabase/functions/_shared/ai/prompts.ts`
- `/home/user/dishton/supabase/functions/_shared/ai/validate.ts`
- `/home/user/dishton/supabase/functions/_shared/ai/rate-budget.ts`
- `/home/user/dishton/supabase/functions/_shared/log.ts`
- `/home/user/dishton/supabase/functions/_shared/env.ts` (defines
  `ANTHROPIC_API_KEY`, optional `ANTHROPIC_MODEL`, `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`)
- A migration adding `public.app_reserve_ai_budget(bigint)`.

## Acceptance criteria

- [ ] `aiChat` retries on 5xx and 429 only, with backoff `1s/2s/4s` plus jitter.
- [ ] One re-prompt occurs on JSON parse failure; a second failure surfaces
      `reason: 'parse'`.
- [ ] `Recipe.safeParse` is the only Zod entry point — no other code path
      writes a Recipe to the DB without going through it.
- [ ] `withRateBudget` returns `'rate_limit'` when reservation fails; the Edge
      Function maps that to HTTP 429 for the SPA.
- [ ] No file outside `supabase/functions/**` reads `ANTHROPIC_API_KEY`.
- [ ] `RECIPE_JSON_SHAPE` includes every field present in the Zod `Recipe`
      schema (asserted by a parity test).
- [ ] Each Edge Function logs at most one `kind: 'ai_call'` line per Anthropic
      call.
- [ ] System prompt block is sent with `cache_control: {type: 'ephemeral'}`;
      after the first request `usage.cache_read_input_tokens > 0`.
- [ ] No emojis in this doc or any governed file.

## Verification

```bash
test -f docs/07-ai-integration.md
grep -q "## Purpose"                docs/07-ai-integration.md
grep -q "## Files this doc governs" docs/07-ai-integration.md
grep -q "## Acceptance criteria"    docs/07-ai-integration.md
grep -q "## Verification"           docs/07-ai-integration.md
! grep -P '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]' docs/07-ai-integration.md
for s in aiChat callAndValidate withRateBudget RECIPE_JSON_SHAPE \
         app_reserve_ai_budget claude-haiku-4-5; do
  grep -q "$s" docs/07-ai-integration.md || echo "missing: $s"
done
```

After implementation:

```bash
cd supabase/functions && deno task test
```
