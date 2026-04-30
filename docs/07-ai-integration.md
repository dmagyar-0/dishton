# 07 — AI Integration (NVIDIA NIM)

## Purpose

Specify the server-side NVIDIA NIM client used by every Edge Function: how it
authenticates, retries, validates output against the canonical Recipe Zod
schema, gates calls behind the rate budget, and logs cost. This doc owns the
NVIDIA-facing surface; the import flows that consume it are in
[08-import-pipelines.md](./08-import-pipelines.md). The NVIDIA API key never
leaves the Edge Function process.

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
      client.ts          — NIM client wrapper
      prompts.ts         — typed prompt templates
      rate-budget.ts     — withRateBudget(estimate, fn)
      validate.ts        — Zod-bridge + re-prompt-once helper
      log.ts             — structured log lines
    domain/              — symlink to /home/user/dishton/src/domain
    env.ts               — typed env loader
    mock_fetch.ts        — used by tests; see doc 12
```

The `domain` symlink lets Edge Functions import from `_shared/domain/recipe.ts`
which resolves to the real file under `src/domain/`. This makes the Recipe
schema literally the same module on both sides.

## NIM client

```ts
// supabase/functions/_shared/ai/client.ts
import { OpenAI } from 'npm:openai@4';
import { env } from '../env.ts';

export type Lane = 'text' | 'vision';

const BASE_URL = 'https://integrate.api.nvidia.com/v1';

const TIMEOUT_MS: Record<Lane, number> = { text: 30_000, vision: 60_000 };
const MAX_RETRIES = 3;
const BACKOFF_MS = [1_000, 2_000, 4_000];

const client = new OpenAI({
  apiKey: env.NVIDIA_API_KEY,
  baseURL: BASE_URL,
});

export type NimCallOpts = {
  lane: Lane;
  model?: string;
  messages: OpenAI.ChatCompletionMessageParam[];
  estimatedTokens: number;          // for rate budget
  signal?: AbortSignal;
};

export async function nimChat(opts: NimCallOpts): Promise<{
  content: string;
  usage: { input: number; output: number };
}> {
  const model = opts.model ??
    (opts.lane === 'text' ? env.NIM_TEXT_MODEL : env.NIM_VISION_MODEL);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), TIMEOUT_MS[opts.lane]);
    try {
      const res = await client.chat.completions.create({
        model,
        messages: opts.messages,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        max_tokens: 4096,
        stream: false,
      }, { signal: opts.signal ?? ac.signal });
      clearTimeout(t);
      const content = res.choices[0]?.message?.content ?? '';
      return {
        content,
        usage: {
          input: res.usage?.prompt_tokens ?? 0,
          output: res.usage?.completion_tokens ?? 0,
        },
      };
    } catch (err) {
      clearTimeout(t);
      if (attempt === MAX_RETRIES - 1) throw err;
      // 4xx other than 429 — do not retry.
      const status = (err as { status?: number }).status;
      if (status && status >= 400 && status < 500 && status !== 429) throw err;
      const jitter = Math.random() * 250;
      await new Promise(r => setTimeout(r, BACKOFF_MS[attempt] + jitter));
    }
  }
  throw new Error('unreachable');
}
```

Notes:

- `response_format: json_object` works against NIM-hosted Llama 3.x. For models
  that do not honor it, fall back to the `validate.ts` re-prompt described
  below.
- `temperature: 0.1` makes structuring deterministic. Translation prompts use
  `0.2` (set explicitly when calling).
- The OpenAI SDK respects `AbortSignal` and propagates timeouts.

## Prompts

`prompts.ts` exports four template functions. Each returns the full
`messages` array for a `nimChat` call. The Recipe schema is referenced by name
inside the prompt and **also** sent as the last message so the model sees the
exact field shape — this is the most reliable structured-output technique on
open-weight models.

```ts
import type { OpenAI } from 'npm:openai@4';

const RECIPE_JSON_SHAPE = `
The JSON object MUST match this TypeScript type exactly:

{
  "title": string,                 // 1-200 chars
  "description": string | null,
  "source_type": "url"|"instagram"|"photo"|"manual",
  "source_url": string | null,
  "source_language": string,        // BCP-47 like "en" or "fr-CA"
  "canonical_unit_system": "metric"|"imperial",
  "servings": number,               // 1-200, integer
  "total_time_min": number | null,
  "tags": string[],
  "ingredients": [
    {
      "position": number,           // 0-based
      "raw_text": string,
      "quantity": number | { "numerator": int, "denominator": int } | null,
      "unit": string | null,        // canonical key: g,kg,oz,lb,ml,l,tsp,tbsp,
                                    //   cup_us,cup_metric,fl_oz,count,C,F,min,h
      "ingredient_name": string | null,
      "notes": string | null,
      "scalable": boolean,
      "non_scalable_qty": "to_taste"|"pinch"|"dash"|"splash"|"handful"|"optional"|null
    }
  ],
  "steps": [
    { "position": number, "body": string, "duration_min": number | null }
  ]
}

Rules:
- Output ONLY a single JSON object. No prose, no code fences, no commentary.
- If a quantity is ambiguous (e.g. "a pinch"), set quantity=null and
  non_scalable_qty to the matching token; scalable=false.
- "cup" defaults to "cup_us" (240 ml). For European-language sources, use
  "cup_metric" (250 ml).
- Preserve the source language verbatim; do NOT translate.
`.trim();

export function structuringFromHtml(args: {
  html: string; sourceUrl: string; hint?: string;
}): OpenAI.ChatCompletionMessageParam[] {
  return [
    {
      role: 'system',
      content: `You convert recipe HTML into a strict JSON object. ${RECIPE_JSON_SHAPE}`,
    },
    {
      role: 'user',
      content:
`Source URL: ${args.sourceUrl}
${args.hint ? `Hint: ${args.hint}\n` : ''}
HTML (already cleaned by Readability):
"""
${args.html}
"""`,
    },
  ];
}

export function structuringFromCaption(args: {
  caption: string; sourceUrl: string;
}): OpenAI.ChatCompletionMessageParam[] {
  return [
    {
      role: 'system',
      content: `You convert an Instagram recipe caption into strict JSON. ${RECIPE_JSON_SHAPE}`,
    },
    {
      role: 'user',
      content:
`Source URL: ${args.sourceUrl}
Caption:
"""
${args.caption}
"""

If the caption contains hashtags or emojis, ignore them. If servings or
total_time_min are not stated, set them to null and 1 respectively.`,
    },
  ];
}

export function structuringFromImage(args: {
  imageUrl: string;
}): OpenAI.ChatCompletionMessageParam[] {
  return [
    {
      role: 'system',
      content:
`You read recipes from photographs (handwriting, cookbook scans, screenshots)
and output strict JSON. ${RECIPE_JSON_SHAPE}`,
    },
    {
      role: 'user',
      content: [
        { type: 'text',
          text: 'Extract the recipe in this image. If parts are unreadable, set them to null. Do not invent ingredients.' },
        { type: 'image_url', image_url: { url: args.imageUrl } },
      ],
    },
  ];
}

export function translatePrompt(args: {
  recipeJson: string; targetLanguage: string;
}): OpenAI.ChatCompletionMessageParam[] {
  return [
    {
      role: 'system',
      content:
`You translate a Dishton Recipe JSON into ${args.targetLanguage}. Only translate
human-readable strings: title, description, ingredient.raw_text,
ingredient.ingredient_name, ingredient.notes, step.body, tags. Do NOT change
quantity, unit, position, source_type, source_url, source_language, servings,
total_time_min, scalable, non_scalable_qty, canonical_unit_system. Preserve
the JSON shape exactly. Output ONLY the JSON object.`,
    },
    { role: 'user', content: args.recipeJson },
  ];
}
```

The `RECIPE_JSON_SHAPE` constant lives in `prompts.ts` and is generated from
`Recipe` at module load via `zodToJsonSchema` for an automated parity test —
the test in [12-testing-strategy.md](./12-testing-strategy.md) asserts that
`RECIPE_JSON_SHAPE` mentions every field in the Zod schema. This catches the
case of a future Recipe field being added but not advertised to the model.

## Validation pipeline

```ts
// supabase/functions/_shared/ai/validate.ts
import { Recipe } from '../domain/recipe.ts';
import { nimChat, NimCallOpts } from './client.ts';

export type ValidationResult =
  | { ok: true; recipe: import('../domain/recipe.ts').Recipe;
      usage: { input: number; output: number } }
  | { ok: false; reason: 'parse'|'schema'|'rate_limit'|'upstream'; raw: string };

export async function callAndValidate(
  opts: NimCallOpts,
): Promise<ValidationResult> {
  const first = await nimChat(opts);
  let parsed = tryParseJson(first.content);
  if (!parsed.ok) {
    // one re-prompt with the parse error
    const retry = await nimChat({
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
    if (!parsed.ok) {
      return { ok: false, reason: 'parse', raw: retry.content };
    }
    first.usage.input += retry.usage.input;
    first.usage.output += retry.usage.output;
  }
  const safe = Recipe.safeParse(parsed.value);
  if (!safe.success) {
    return { ok: false, reason: 'schema', raw: JSON.stringify(parsed.value) };
  }
  return { ok: true, recipe: safe.data, usage: first.usage };
}

function tryParseJson(text: string):
  | { ok: true; value: unknown }
  | { ok: false; error: string } {
  try {
    // strip a possible code-fence the model added against instructions
    const cleaned = text.trim().replace(/^```json\s*/, '').replace(/\s*```$/, '');
    return { ok: true, value: JSON.parse(cleaned) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
```

If `ok: false` with reason `parse` or `schema`, the calling Edge Function:

1. writes the raw model output to `import_jobs.payload.raw_model_output`,
2. sets `import_jobs.status = 'needs_review'`,
3. returns the partial draft to the SPA so the user can edit manually.

## Rate budget

```ts
// supabase/functions/_shared/ai/rate-budget.ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { env } from '../env.ts';

const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

export type BudgetReason = 'ok' | 'rate_limit';

export async function withRateBudget<T>(
  estimatedTokens: number,
  fn: () => Promise<T>,
): Promise<{ status: BudgetReason; value?: T }> {
  // Reset if window > 60s old. Then attempt to reserve budget atomically.
  const reserved = await admin.rpc('app_reserve_ai_budget', {
    p_tokens: estimatedTokens,
  });
  if (reserved.error) throw reserved.error;
  if (reserved.data === false) return { status: 'rate_limit' };
  const value = await fn();
  return { status: 'ok', value };
}
```

The Postgres function does the atomic update:

```sql
create or replace function public.app_reserve_ai_budget(p_tokens bigint)
returns boolean language plpgsql security definer as $$
declare row app.ai_rate_budget%rowtype;
begin
  select * into row from app.ai_rate_budget for update;
  if row.window_started_at < now() - interval '60 seconds' then
    update app.ai_rate_budget
       set window_started_at = now(), tokens_used = 0;
    row.tokens_used = 0;
  end if;
  if row.tokens_used + p_tokens > row.budget_per_minute then
    return false;
  end if;
  update app.ai_rate_budget set tokens_used = tokens_used + p_tokens;
  return true;
end;
$$;
```

Add this RPC to the `*_imports.sql` migration referenced in
[04-data-model.md](./04-data-model.md).

`budget_per_minute` defaults to 60 000 tokens. Tunable per environment via the
row itself, no code change required.

`estimatedTokens` per lane:

| Lane | Estimate |
|---|---|
| URL structuring | 4 000 (HTML can be long) |
| Instagram structuring | 1 200 |
| Photo structuring | 3 500 (vision tokens are expensive) |
| Translation | 2 500 |

After the call, the `payload.tokens_in` / `tokens_out` written to
`import_jobs` reflect actuals; the budget is not re-credited (over-estimation
is intentional safety margin).

## Cost / usage logging

Each NIM call appends a structured log line via `log.ts`:

```ts
// supabase/functions/_shared/ai/log.ts
export function logNimCall(fields: {
  request_id: string;
  function: string;
  lane: 'text'|'vision';
  model: string;
  ms: number;
  tokens_in: number;
  tokens_out: number;
  ok: boolean;
  reason?: string;
}) {
  console.log(JSON.stringify({ kind: 'nim_call', ...fields }));
}
```

The aggregator picks these up via the log drain (see
[14-observability.md](./14-observability.md)). The `app.v_ai_daily_cost`
view aggregates them for the in-app dashboard.

## Mocking in tests

`supabase/functions/_shared/mock_fetch.ts` (described in
[12-testing-strategy.md](./12-testing-strategy.md)) installs over
`globalThis.fetch`. The `OpenAI` SDK uses `fetch` internally so mocking is one
hook for everything. Tests assert the request URL is
`https://integrate.api.nvidia.com/v1/chat/completions` and that the
authorization header carries the env key.

Local development can also set `NIM_MOCK_MODE=playwright` to read canned
responses from `e2e/fixtures/nim-*.json` instead of contacting NVIDIA — this
is what the E2E smoke uses (see [12-testing-strategy.md](./12-testing-strategy.md)).

## Files this doc governs

- `/home/user/dishton/supabase/functions/_shared/ai/client.ts`
- `/home/user/dishton/supabase/functions/_shared/ai/prompts.ts`
- `/home/user/dishton/supabase/functions/_shared/ai/validate.ts`
- `/home/user/dishton/supabase/functions/_shared/ai/rate-budget.ts`
- `/home/user/dishton/supabase/functions/_shared/ai/log.ts`
- `/home/user/dishton/supabase/functions/_shared/env.ts` (defines
  `NVIDIA_API_KEY`, `NIM_TEXT_MODEL`, `NIM_VISION_MODEL`,
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)
- A migration adding `public.app_reserve_ai_budget(bigint)`.

## Acceptance criteria

- [ ] `nimChat` retries on 5xx and 429 only, with backoff `1s/2s/4s` plus jitter.
- [ ] One re-prompt occurs on JSON parse failure; a second failure surfaces
      `reason: 'parse'`.
- [ ] `Recipe.safeParse` is the only Zod entry point — no other code path
      writes a Recipe to the DB without going through it.
- [ ] `withRateBudget` returns `'rate_limit'` when reservation fails; the Edge
      Function maps that to HTTP 429 for the SPA.
- [ ] No file outside `supabase/functions/**` reads `NVIDIA_API_KEY`.
- [ ] `RECIPE_JSON_SHAPE` includes every field present in the Zod `Recipe`
      schema (asserted by a parity test).
- [ ] Each Edge Function logs at most one `kind: 'nim_call'` line per NIM call.
- [ ] No emojis in this doc or any governed file.

## Verification

```bash
test -f docs/07-ai-integration.md
grep -q "## Purpose"                docs/07-ai-integration.md
grep -q "## Files this doc governs" docs/07-ai-integration.md
grep -q "## Acceptance criteria"    docs/07-ai-integration.md
grep -q "## Verification"           docs/07-ai-integration.md
! grep -P '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]' docs/07-ai-integration.md
for s in nimChat callAndValidate withRateBudget RECIPE_JSON_SHAPE \
         app_reserve_ai_budget integrate.api.nvidia.com; do
  grep -q "$s" docs/07-ai-integration.md || echo "missing: $s"
done
```

After implementation:

```bash
pnpm test:edge --filter=ai
pnpm test:edge --filter=rate-budget
```
