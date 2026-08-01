# 14 — Observability

## Purpose

Define how Dishton sees itself once it is running: frontend error tracking
with Sentry (including source maps and import-flow breadcrumbs), backend
structured logging from Edge Functions drained to **Better Stack (Logtail)**,
first-party **product metrics** (active users, app opens, import funnel,
AI cost in USD, Edge Function call outcomes) stored in Postgres and surfaced
at `/admin/metrics`, the legacy per-household AI cost view
`app.v_ai_daily_cost`, the SLOs that turn raw signal into "is the import
flow OK", and a lightweight on-call runbook for the three failure modes that
matter (import failing, auth broken, RLS regressed). This is a side-project
scale operation — the goal is "I can fix it within a session", not 24/7
paging.

## Prerequisites

- [00-overview.md](./00-overview.md) — locked tooling.
- [01-architecture.md](./01-architecture.md) — process boundaries (SPA,
  Edge Function, Postgres) so each emits the right signal.
- [04-data-model.md](./04-data-model.md) — `import_jobs` table whose
  `payload` column carries token counts.
- [07-ai-integration.md](./07-ai-integration.md) — Anthropic call sites
  whose latency, token usage, and cache hits are logged.
- [08-import-pipelines.md](./08-import-pipelines.md) — the import flow
  whose breadcrumbs and SLOs are defined here.
- [13-ci-cd-and-environments.md](./13-ci-cd-and-environments.md) —
  `SENTRY_DSN_*`, `LOG_DRAIN_TOKEN` (Better Stack / Logtail), and
  `SENTRY_AUTH_TOKEN` secrets.

## Frontend — Sentry

The SPA uses `@sentry/react`. Initialised in
`/home/user/dishton/src/observability/sentry.ts` and called from
`src/main.tsx` before the React tree mounts.

Configuration:

- DSN from `import.meta.env.VITE_SENTRY_DSN_FRONTEND`. Empty in `local`,
  set in `preview` and `production` per
  [13-ci-cd-and-environments.md](./13-ci-cd-and-environments.md).
- `tracesSampleRate: 0.1` in `production`, `1.0` in `preview`.
- `replaysSessionSampleRate: 0.0`, `replaysOnErrorSampleRate: 0.5`. We
  capture replays only when an error fires, never proactively, to keep
  the cookbook content out of Sentry.
- `release` set to the Git short SHA injected at build time via Vite's
  `define` config.
- `environment` set from `import.meta.env.MODE` (`development`,
  `preview`, `production`).

Source maps:

- Vite emits **hidden** source maps for production builds
  (`build.sourcemap: 'hidden'` in `vite.config.ts`): the `*.map` files are
  written but the `//# sourceMappingURL` comment is omitted, so the maps are
  never referenced from — or served to — the browser.
- The `deploy.yml` workflow uploads the maps to Sentry with
  `@sentry/cli sourcemaps inject` + `upload` (keyed to the release =
  Git SHA), guarded by `SENTRY_AUTH_TOKEN`. When the token is absent the
  upload step is skipped cleanly and the deploy still succeeds.
- Immediately after the upload, the workflow strips every `*.map` from the
  Vercel deploy artifact (`find .vercel/output -name '*.map' -delete`) so no
  maps ship to production. The `ci.yml` `build` job likewise strips `*.map`
  from its `dist/` artifact.

Import-flow breadcrumbs:

The import flow is the highest-stakes UX in the app, so every step pushes
a Sentry breadcrumb with `category: 'import'`. Breadcrumbs (in order):

1. `import.start` — data: `{ kind: 'url' | 'instagram' | 'photo' | 'manual' }`.
2. `import.input.validated` — data: input length / file size / URL host.
3. `import.request.sent` — data: `function`, `request_id`.
4. `import.response.received` — data: `latency_ms`, `status`.
5. `import.draft.parsed` — data: ingredient count, step count.
6. `import.draft.edited` — data: which fields the user changed.
7. `import.draft.saved` — data: `recipe_id`.

Errors thrown anywhere in the flow surface as Sentry exceptions with the
breadcrumb trail intact. Each breadcrumb is at most 256 bytes — no recipe
content is captured, only counts and metadata.

User context:

- `Sentry.setUser({ id: profile_id })` after auth, with no email or name.
  PII is intentionally minimal.
- `Sentry.setTag('household_id', household_id)` once a household is
  selected.

## Backend — structured logs to Better Stack (Logtail)

**Decision: drain Supabase logs to Better Stack (Logtail).** Reasons:

- Native Supabase log-drain integration; one config field, no proxy.
- Free tier covers 1 GB/month, comfortably above expected volume.
- Live tail UI plus SQL-style query language good enough for incident
  triage, with retention long enough (3 days on free, 30 days on cheap
  paid tier) to investigate a Monday morning weekend regression.

Rejected alternatives: Datadog (overkill, expensive at small scale),
Axiom (good but newer, fewer Supabase integration examples), self-hosted
Grafana Loki (operational overhead we won't pay).

Edge Functions emit a single JSON object per significant event using a
shared logger at `/home/user/dishton/supabase/functions/_shared/log.ts`.

Required fields on every log line:

| Field | Type | Source |
|---|---|---|
| `timestamp` | ISO-8601 string | `new Date().toISOString()` |
| `level` | `'debug' \| 'info' \| 'warn' \| 'error'` | call site |
| `request_id` | UUID string | `crypto.randomUUID()` per request |
| `profile_id` | UUID string or `null` | resolved JWT claim |
| `household_id` | UUID string or `null` | resolved from request |
| `function` | string | function name (`import-url`, etc.) |
| `event` | string | machine-readable event name (e.g. `ai.call.start`) |
| `latency_ms` | number or `null` | duration of the bracketed work |
| `ai_tokens_in` | number or `null` | Anthropic prompt tokens, when applicable |
| `ai_tokens_out` | number or `null` | Anthropic completion tokens, when applicable |
| `ai_cache_read` | number or `null` | tokens served from prompt cache (Anthropic `cache_read_input_tokens`) |
| `ai_cache_write` | number or `null` | tokens written to prompt cache (Anthropic `cache_creation_input_tokens`) |
| `ai_model` | string or `null` | model id used (e.g. `claude-haiku-4-5`) |
| `error` | object or `null` | `{ name, message, stack }` if `level==='error'` |

`console.log(JSON.stringify(line))` is the transport. Supabase captures
stdout and forwards it to the configured log drain; the Logtail token is
set in the Supabase Dashboard per project per
[13-ci-cd-and-environments.md](./13-ci-cd-and-environments.md).

Required events per import function:

- `request.start` (level=`info`, `latency_ms=null`)
- `ai.call.start` (level=`info`)
- `ai.call.end` (level=`info`, includes `latency_ms`, `ai_tokens_*`, `ai_cache_*`)
- `ai.parse.failure` (level=`warn`) — emitted when re-prompting is needed
- `rate_budget.deny` (level=`warn`)
- `request.end` (level=`info`, `latency_ms` for the whole request)
- `request.error` (level=`error`, `error` populated)

> **Current posture (2026-06):** Edge Functions do NOT ship to Sentry.
> `SENTRY_DSN_FUNCTIONS` is declared in `_shared/env.ts` but unused; the
> only Edge Function telemetry is the structured stdout above, forwarded
> by the platform log drain. Error visibility therefore depends on a
> Better Stack alert on `event=request.error` — see
> [runbooks/alerting.md](./runbooks/alerting.md) for the exact queries
> and the dashboard-side setup this requires. Wiring `@sentry/deno`
> remains a roadmap item, not a shipped feature.

## Product metrics

First-party product analytics and AI cost accounting, stored in Postgres and
surfaced to admins at `/admin/metrics`. Schema in
`supabase/migrations/20260801120000_product_metrics.sql`. **Not** a
third-party SDK (PostHog/Plausible/GA) — the app's whole privacy posture is
"cookbook content never leaves the browser" (Sentry masks all text and blocks
all media), and the data this needs (import cost in USD, per-job token usage,
Edge Function call outcomes) already lives in Postgres. Cost of first-party:
one migration, one reaper, one dashboard route.

### `app.analytics_events`

Append-only client telemetry, written directly by the SPA from
`src/observability/analytics.ts`.

```sql
create table app.analytics_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  profile_id uuid references app.profiles(id) on delete set null,
  household_id uuid references app.households(id) on delete set null,
  session_id uuid not null,        -- client-generated, per browser session
  event text not null check (event in (
    'app_open', 'app_resume', 'import_started', 'import_succeeded', 'import_failed',
    'edge_call', 'recipe_viewed', 'search_performed', 'signup_completed'
  )),
  props jsonb not null default '{}'::jsonb check (pg_column_size(props) < 2048),
  release_sha text,
  display_mode text check (display_mode in ('standalone', 'browser')),
  created_at timestamptz not null default now()
);
```

**RLS posture — insert-only, on purpose.** The only policy is
`insert to authenticated with check (profile_id = (select auth.uid()))`, and
`insert` is the only grant. There is deliberately **no** `select`/`update`/
`delete` policy at all — an authenticated user cannot read back their own
events, let alone anyone else's. Reads happen exclusively through the
admin-gated `app.metrics_*` RPCs below, which run `security definer` and
check `app.is_app_admin()` first. This keeps "every signed-in user can write
a telemetry row" and "only an admin can query telemetry" as two separate,
independently-enforced guarantees — a bug in the RPC layer can't turn into a
row-level read leak, because there is no row-level read grant to leak.

**Prop allowlist, and why it exists.** `props` is free-form `jsonb` at the
schema level (capped at 2 KB by the `pg_column_size` check), but
`src/observability/analytics.ts` enforces a small allowlist of scalar keys
(`kind`, `source`, `method`, `error_code`, `latency_ms`, `ms`, `status`,
`fn`, `outcome`, `result_count`) in `sanitizeProps()` before anything is
queued — any key not on the list is silently dropped, and any value that
isn't a string/number/boolean/null is dropped too. This is the enforcement
point, not just documentation: it's what stops a future call site from
passing a recipe title, a search query, a URL, or an email address into a
column that has no RLS protecting reads. String props are also truncated to
200 characters. `event` itself is constrained by the table's `check`, so the
event vocabulary can't drift silently either.

### `app.ai_usage`

One row per Anthropic call, written by Edge Functions with a true
service-role client (`aiUsageAdminClient()` in
`supabase/functions/_shared/ai-usage.ts`) via `recordAiUsage()`. Supersedes
reading tokens out of `import_jobs.payload` (overwritten on save, and
doesn't exist at all for `translate-recipe`).

Columns: `function`, `lane` (`'text' | 'vision'`), `model`, `profile_id`,
`household_id`, `request_id`, `import_job_id`, `tokens_in`, `tokens_out`,
`cache_read`, `cache_write`, `latency_ms`, `ok`, `reason`.

RLS is enabled with **no policies at all** — only `service_role` can write
(RLS bypass plus an explicit `grant insert ... to service_role`, per the
existing pattern in `20260607123645_grant_service_role_app_agent_tables.sql`)
and reads happen exclusively through `app.metrics_ai_cost`. `recordAiUsage()`
swallows every error internally and never throws or delays the response it's
describing — telemetry must never fail an import.

### `app.ai_model_prices`

Pricing as data, not code: a price change is a row insert, not a deploy.

```sql
create table app.ai_model_prices (
  model text not null,
  effective_from date not null default '2026-01-01',
  input_usd_per_mtok numeric(10, 4) not null,
  output_usd_per_mtok numeric(10, 4) not null,
  cache_read_usd_per_mtok numeric(10, 4) not null,
  cache_write_usd_per_mtok numeric(10, 4) not null,
  primary key (model, effective_from)
);
```

Seeded with Anthropic list prices (cache read = 0.1x input, 5-minute cache
write = 1.25x input) for `claude-haiku-4-5`, `claude-sonnet-4-6`,
`claude-opus-5`, `claude-sonnet-5`. `app.metrics_ai_cost` joins each
`ai_usage` row to the newest `ai_model_prices` row for that model with
`effective_from <= occurred_at::date` via `left join lateral`, so a
supported-price change takes effect only for usage from that date forward.
No policies or grants at all — `metrics_ai_cost` is `security definer` and
reads the table directly; nobody else needs to. Pure USD arithmetic lives in
`src/domain/ai-cost.ts` (`usdForUsage`, `formatUsd`) — no I/O, tested at the
domain coverage threshold.

### `app.app_admins` and `app.is_app_admin()`

Global metrics span households, so the existing household-owner gating
(`app.is_household_owner`) is insufficient — this is a new, minimal admin
concept, unrelated to household roles.

```sql
create table app.app_admins (
  profile_id uuid primary key references app.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
```

No `anon`/`authenticated` policies or grants on the table at all — it is
`service_role`-only and seeded by hand. `app.is_app_admin()` is a
`security definer` SQL function that reads the table on the caller's behalf
so a client can check its own status (`select app.is_app_admin()`) without
needing a `select` grant:

```sql
create or replace function app.is_app_admin() returns boolean
  language sql stable security definer set search_path = app, public as $$
  select exists (select 1 from app.app_admins where profile_id = auth.uid());
$$;
```

Granted to `authenticated`. To promote a user, run by hand against the
target project (the migration deliberately never hardcodes a UUID or
email):

```sql
insert into app.app_admins (profile_id)
select id from auth.users where email = 'someone@example.com'
on conflict (profile_id) do nothing;
```

Locally, `supabase/seed.sql` seeds `alice` (profile id
`00000000-0000-0000-0000-000000000001`) as an app admin so `/admin/metrics`
is reachable without a by-hand insert during local dev and the
design-synch capture spec.

The SPA guards `/admin/metrics` with `requireAppAdmin()` in
`src/routes/_guards.ts`: an async check that awaits `is_app_admin()` and
fails **closed** on every uncertain outcome (RPC error, thrown exception) —
a non-admin, or anyone the RPC couldn't confirm, is redirected to `/`, never
shown a "forbidden" page or a partially-loaded dashboard.

### Retention

`app.reap_analytics_events()` — `security definer`, `service_role` only —
deletes `analytics_events` rows older than **180 days** and `ai_usage` rows
older than **400 days**, returning the total row count removed. Unlike
`app.reap_stuck_imports`, this must run `security definer` because
`analytics_events`/`ai_usage` have no authenticated write policies at all, so
there is no self-scoped "reap my own rows" caller path — it is invoked the
same way the existing reaper patterns in the migrations directory are
(by hand or from a scheduled job), not run automatically by this migration.

### The six `app.metrics_*` RPCs

Every one is `security definer` (they read across all households/profiles,
which RLS alone would never allow), checks `app.is_app_admin()` **first**
and `raise exception 'not_app_admin'` if the caller isn't one, is revoked
from `public`/`anon`, and is granted to `authenticated` — the admin route
calls these with the signed-in admin's own JWT, and the admin check happens
inside the function on every call, not just at the SPA route guard.

| RPC | Signature | Returns |
|---|---|---|
| `metrics_active_users` | `(p_from date, p_to date)` | `day, dau, wau_rolling, mau_rolling` — distinct `profile_id` from `analytics_events`, with 7-/30-day rolling windows anchored on each day |
| `metrics_app_opens` | `(p_from date, p_to date)` | `day, opens, resumes, standalone_opens, unique_sessions` |
| `metrics_imports` | `(p_from date, p_to date)` | `day, kind, started, succeeded, failed, p50_ms, p95_ms` — from `app.import_jobs`, restricted to terminal statuses (`done`/`failed`/`needs_review`); latency is `completed_at - created_at` |
| `metrics_ai_cost` | `(p_from date, p_to date)` | `day, function, model, calls, tokens_in, tokens_out, cache_read, cache_write, usd, unpriced_calls` |
| `metrics_edge_failures` | `(p_from date, p_to date)` | `day, fn, outcome, calls, p95_ms` — from `analytics_events` where `event = 'edge_call'`, grouped on `props->>'fn'` / `props->>'outcome'` |
| `metrics_stuck_imports` | `()` | `id, profile_id, household_id, kind, status, created_at, age_minutes` — `import_jobs` rows `queued`/`running` for more than 15 minutes, right now (no date range: this is a "what's on fire" query, not a historical one) |

`metrics_edge_failures` and `metrics_stuck_imports` are, respectively, the
client-side and server-side halves of the same question — "the SPA fired a
request and the Edge Function never answered" — see the `edge_call` outcome
taxonomy below for the client side.

TanStack Query hooks for all six live in `src/lib/queries/metrics.ts`; the
`/admin/metrics` page (`src/routes/admin/metrics.tsx` +
`src/ui/admin/AdminMetricsPage.tsx`) renders one section per RPC (Active
users, App opens, Imports, AI cost, Edge reliability — the last of which
also renders the stuck-imports table) plus a 7/30/90-day range selector,
using hand-rolled SVG charts under `src/ui/admin/charts/` (no new chart
dependency).

### `edge_call` outcome taxonomy

`src/lib/invoke-function.ts` wraps every `supabase.functions.invoke()` call
so it always resolves to exactly one outcome, emitted as an `edge_call`
analytics event (`{ fn, outcome, status, ms }`) and, for anything other than
`ok`, also pushed as a Sentry breadcrumb. Call sites:
`src/routes/h/$householdId/import.tsx`, `src/lib/queries/recipe-chat.ts`,
`src/lib/queries/translations.ts`.

| Outcome | Condition | What a spike tells you |
|---|---|---|
| `ok` | Resolved with no error. | Nothing — baseline. |
| `http_error` | `FunctionsHttpError` with a non-2xx status the function itself returned (ordinarily 4xx). | The function is answering but rejecting requests — bad input, auth/RLS failure, a rate-budget deny. Check the function's own logic, not the platform. |
| `no_response` | A `FunctionsHttpError` carrying a 502/503/504, or a `FunctionsRelayError` (the Supabase relay couldn't reach the function at all). | Gateway/boot failure: cold-start timeout, crash on boot, region outage. The function never got to answer for itself — this is a platform-level signal, not an application bug. |
| `timeout` | A `FunctionsFetchError` where *our own* `AbortController` (armed by the caller's `timeoutMs`) is the one that fired. | The client gave up waiting. Correlate with `no_response`/latency on the same function — if `no_response` isn't also spiking, the function is probably just slow, not down. |
| `network` | A `FunctionsFetchError` that isn't attributable to our own timeout controller (offline, DNS, TLS), or an unrecognised error shape. | Client-side connectivity, or a `supabase-js` version whose error shapes changed — classified conservatively rather than thrown out of a telemetry wrapper. |

**Known limitation:** `@supabase/functions-js` throws a `FunctionsFetchError`
for *any* aborted or rejected `fetch()`, with no way to tell "our own
timeout fired" apart from "a genuine network failure" other than tracking
which `AbortController` fired. `invoke-function.ts` only tracks the
`AbortController` it creates internally for `timeoutMs` — a caller-supplied
`AbortSignal` aborting (e.g. an unmounted component's own cleanup) is
classified as `network`, not `timeout`, because the wrapper has no way to
attribute that abort to "we gave up waiting" versus "something else aborted
this." This means `network` is a mixed bucket: real connectivity failures
and caller-initiated aborts both land there.

### Limitations (read before trusting a number on the dashboard)

- **Recipe-chat AI spend is not captured.** `recipe-chat-send` dispatches to
  a Managed Agent, and the agent's reply returns asynchronously via
  `recipe-chat-webhook` — a webhook payload that carries no token or model
  data to attribute back to `app.ai_usage`. Neither function calls
  `recordAiUsage()`. Chat cost is **absent from the AI cost dashboard
  entirely**, not zero — do not read "chat doesn't show up" as "chat is
  free."
- **Unpriced models are silently counted, loudly surfaced.** A model with no
  matching `app.ai_model_prices` row contributes `$0` to `usd` (rather than
  failing the query or being dropped from the result set), but every such
  call is counted in `unpriced_calls`. `AiCostSection` renders a visible
  warning banner whenever `unpriced_calls > 0` — if the total USD figure
  looks implausibly low, check that banner before trusting it.
- **The Supabase client is untyped at call sites.** `src/lib/supabase.ts`
  calls `createClient()` without the `Database` generic (a preexisting
  decision, not new to this feature), so every `.from()`/`.rpc()` call in
  `src/observability/analytics.ts` and `src/lib/queries/metrics.ts` is
  untyped even though `src/lib/database.types.ts` now accurately describes
  `analytics_events`, `ai_usage`, `ai_model_prices`, and all six RPCs.
  Callers cast RPC results by hand (`as unknown as ActiveUsersRow[]`, etc.)
  the same way the rest of `src/lib/queries/*.ts` already does — a typo in a
  column name will not be caught by `pnpm typecheck`.
- **Analytics is opt-in and silent when it can't run.** `track()` in
  `src/observability/analytics.ts` is a complete no-op — no queue, no timer,
  no listener — when the `VITE_FEATURE_ANALYTICS` build flag is off, and it
  also no-ops whenever there is no signed-in profile (`useAuth.getState()`
  has no `session.user.id`). Signed-out visits, and any environment where
  the flag isn't set to `true`/`1`, produce zero `analytics_events` rows by
  design, not by failure.

## AI cost dashboard — `app.v_ai_daily_cost`

A read-only Postgres view aggregates token counts from `import_jobs`. The
`import_jobs.payload` column already stores per-job Anthropic token counts
(set by the Edge Functions per
[07-ai-integration.md](./07-ai-integration.md)).

Definition (creation lives in a migration owned by
[04-data-model.md](./04-data-model.md), but the shape is fixed here):

```sql
create or replace view app.v_ai_daily_cost as
select
  date_trunc('day', completed_at)::date            as day,
  household_id,
  count(*)                                         as jobs,
  coalesce(sum((payload->>'tokens_in')::bigint),  0) as tokens_in,
  coalesce(sum((payload->>'tokens_out')::bigint), 0) as tokens_out,
  coalesce(sum((payload->>'tokens_in')::bigint
             + (payload->>'tokens_out')::bigint), 0) as tokens_total
from app.import_jobs
where status = 'done'
group by 1, 2;
```

Access: the base view is service-role-only; owner-scoped reads go through
the SECURITY DEFINER function `app.v_ai_daily_cost_for_household`, which
verifies the caller owns the household.

> **Current posture (2026-08):** there is now an admin dashboard —
> `/admin/metrics`, see "Product metrics" above — but it does **not**
> replace this view. `app.v_ai_daily_cost` /
> `app.v_ai_daily_cost_for_household` still exist, are unchanged, and serve
> a different audience: a **household owner** self-checking their own
> household's token usage, gated by household ownership, with no admin
> concept involved. `/admin/metrics`'s AI cost section is **app-admin-only**
> (`app.is_app_admin()`), spans every household, is priced in USD via
> `app.ai_model_prices` rather than raw tokens, and is sourced from
> `app.ai_usage` rather than `import_jobs.payload` — a materially richer and
> differently-scoped dataset, not an upgrade of this view in place. Cost
> inspection for an owner is still a SQL query away (Dashboard → SQL editor
> → `select * from app.v_ai_daily_cost_for_household('<household>')`) or,
> going forward, the Edge Functions additionally persist `model`,
> `cache_read`, `cache_write` into `import_jobs.payload` alongside the
> existing `tokens_in`/`tokens_out`, so this view gains fidelity for free.
> Daily Anthropic spend alerting is still handled at the provider: set a
> usage limit + email alert in the Anthropic console (see
> [runbooks/alerting.md](./runbooks/alerting.md)). The owner-facing chart
> and the 90%-of-budget banner described in earlier revisions of this doc
> remain unbuilt roadmap items — `/admin/metrics` does not fill that gap,
> since it is admin-only, not owner-facing.

## Error budgets and SLOs

> **Current posture (2026-06):** these targets are aspirational. There is
> no `app.slo_snapshots` table, no scheduled snapshot function, and no
> automated burn-rate alerting; the only alerting that exists is what is
> configured by hand in Better Stack / Sentry / the Anthropic console per
> [runbooks/alerting.md](./runbooks/alerting.md). Treat the table below
> as the definition of "healthy" when reading dashboards manually.

Targets (windowed over the trailing 7 days, intended to be computed via
Logtail saved-queries plus a small Supabase scheduled function writing
into `app.slo_snapshots` — neither exists yet):

| Indicator | Target |
|---|---|
| **Import success rate** (`status='done' / total terminal jobs`) | **>= 95%** |
| **P95 import latency, URL kind** | **< 25 s** |
| **P95 import latency, photo kind** | **< 60 s** |
| **Auth signup success rate** | **>= 99%** |
| **SPA Sentry crash-free sessions** | **>= 99%** |

Burn-rate alerts:

- A trailing-1h success rate below 80% for the URL import flow triggers
  a Logtail alert email.
- A 24h SLO breach files a GitHub issue via the Logtail webhook,
  labelled `incident`, assigned to the on-call (one person; this is a
  side project).

## On-call runbook

For each canonical failure mode, the first three things to check. Each
runbook step links to the page or query that exposes the answer.

### Import failing

1. Open Logtail saved query "import-failures-last-1h":
   `function in ('import-url','import-instagram','import-photo')
    and event = 'request.error'`.
   - If empty, the failure is client-side; jump to Sentry and look for
     exceptions with `category: 'import'` breadcrumbs.
   - If populated, group by `error.name` and pick the most common.
2. Check `app.v_ai_daily_cost` for today: are we above 90% of the
   configured daily budget? If so, the rate budget is throttling and/or
   Anthropic is returning 429s; the fix is to wait, not to deploy.
3. Run `select * from app.import_jobs order by created_at desc limit 20`
   in the Supabase SQL editor and inspect `error` column.

### Auth broken

1. Sentry: filter by `category: 'auth'` and `level: 'error'` over the
   last hour; this almost always shows the symptom (token decode failure,
   URL fragment parse error, OAuth state mismatch).
2. Supabase Dashboard → Authentication → Logs: confirm whether sign-in
   attempts are reaching Supabase at all. If they are not, suspect a
   Vercel env var miss (`VITE_SUPABASE_URL`,
   `VITE_SUPABASE_ANON_KEY`).
3. If Google OAuth specifically is broken, check the feature flag
   `VITE_FEATURE_GOOGLE_AUTH` and the Supabase Authentication provider
   config; per
   [15-roadmap-and-flags.md](./15-roadmap-and-flags.md), enabling Google
   requires both a flag flip and a provider config flip.

### RLS regressed

1. Run `pnpm test:db` against a staging copy of production (cloned via
   `supabase db dump | supabase db push`). If it fails, the regression is
   already covered by tests and the offending migration is the latest
   one.
2. In production, run the canonical RLS probe queries from
   `/home/user/dishton/supabase/tests/rls.test.sql` as profile A, B, C, D
   via `supabase functions invoke` with each profile's JWT; any
   unexpected row count is the smoking gun.
3. If the regression is real, follow the schema rollback procedure in
   [13-ci-cd-and-environments.md](./13-ci-cd-and-environments.md).

## Files this doc governs

- `/home/user/dishton/src/observability/sentry.ts`
- `/home/user/dishton/src/observability/breadcrumbs.ts`
- `/home/user/dishton/src/observability/analytics.ts` — first-party
  `track()`, the prop allowlist, queueing/flush
- `/home/user/dishton/src/domain/ai-cost.ts` — pure USD accounting
  (`usdForUsage`, `formatUsd`)
- `/home/user/dishton/src/lib/invoke-function.ts` — the `edge_call`
  outcome classifier
- `/home/user/dishton/src/lib/queries/metrics.ts` — TanStack Query hooks
  for the six `metrics_*` RPCs plus the admin-flag hooks
- `/home/user/dishton/src/routes/_guards.ts` — `requireAppAdmin`
- `/home/user/dishton/src/routes/admin/metrics.tsx` and
  `/home/user/dishton/src/ui/admin/` — the `/admin/metrics` dashboard route,
  page and sections/charts
- `/home/user/dishton/supabase/functions/_shared/log.ts`
- `/home/user/dishton/supabase/functions/_shared/sentry.ts`
- `/home/user/dishton/supabase/functions/_shared/ai-usage.ts` —
  `recordAiUsage()`, called from `import-url`, `import-instagram`,
  `import-photo`, `translate-recipe` (not `recipe-chat-send`/
  `recipe-chat-webhook` — see Limitations above)
- `/home/user/dishton/supabase/migrations/<ts>_v_ai_daily_cost.sql`
  (owned content-wise by [04-data-model.md](./04-data-model.md), shape
  fixed here)
- `/home/user/dishton/supabase/migrations/20260801120000_product_metrics.sql`
  — `app_admins`, `is_app_admin()`, `analytics_events`, `ai_usage`,
  `ai_model_prices`, `reap_analytics_events()`, and the six `metrics_*` RPCs
- `/home/user/dishton/docs/14-observability.md`

## Acceptance criteria

- [ ] Sentry initialises in `src/main.tsx` before the React tree mounts
      and uses release = Git short SHA.
- [ ] Source maps are emitted as 'hidden', uploaded to Sentry from
      `deploy.yml` (guarded by `SENTRY_AUTH_TOKEN`), and stripped from the
      deploy artifact.
- [ ] Every step of the import flow pushes a Sentry breadcrumb with
      `category: 'import'`.
- [ ] Edge Functions emit JSON log lines with every required field
      listed above.
- [ ] Logs drain to Better Stack (Logtail); the token is set in the
      Supabase Dashboard per environment.
- [ ] `app.v_ai_daily_cost` exists, is RLS-restricted to household
      owners, and powers `app.v_ai_daily_cost_for_household` for
      owner-facing SQL inspection.
- [ ] `app.analytics_events` accepts INSERT only from `authenticated`, for
      `profile_id = auth.uid()`, with no SELECT/UPDATE/DELETE grant of any
      kind.
- [ ] `app.ai_usage` and `app.ai_model_prices` have no `authenticated`
      grants at all; all reads go through `security definer` RPCs.
- [ ] All six `app.metrics_*` RPCs reject a non-admin caller with
      `not_app_admin` before running any query.
- [ ] `/admin/metrics` is reachable only to callers where
      `app.is_app_admin()` is true, fails closed on any RPC error, and
      never renders a distinguishable "forbidden" state.
- [ ] `edge_call` events are emitted for every `invokeFunction()` call with
      one of the five outcomes (`ok`, `http_error`, `no_response`,
      `timeout`, `network`).
- [ ] `app.reap_analytics_events()` deletes `analytics_events` older than
      180 days and `ai_usage` older than 400 days.
- [ ] SLO targets (95% import success, 25s P95 URL, 60s P95 photo) are
      recorded as Logtail saved queries with alert wiring.
- [ ] On-call runbook covers `import failing`, `auth broken`, and
      `RLS regressed`, each with three concrete first steps.
- [ ] No emoji anywhere in the file.

## Verification

Run from `/home/user/dishton`:

```bash
test -f docs/14-observability.md
grep -q "## Purpose"                docs/14-observability.md
grep -q "## Prerequisites"          docs/14-observability.md
grep -q "## Product metrics"        docs/14-observability.md
grep -q "## Files this doc governs" docs/14-observability.md
grep -q "## Acceptance criteria"    docs/14-observability.md
grep -q "## Verification"           docs/14-observability.md
! grep -P '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]' docs/14-observability.md
# core nouns appear
for n in Sentry "Better Stack" "Logtail" v_ai_daily_cost \
         request_id profile_id ai_tokens_in ai_tokens_out \
         analytics_events ai_usage ai_model_prices app_admins is_app_admin \
         metrics_active_users metrics_app_opens metrics_imports \
         metrics_ai_cost metrics_edge_failures metrics_stuck_imports \
         unpriced_calls "/admin/metrics" invoke-function; do
  grep -q -- "$n" docs/14-observability.md || echo "missing concept: $n"
done
# edge_call outcome taxonomy
for o in ok http_error no_response timeout network; do
  grep -q -- "$o" docs/14-observability.md || echo "missing outcome: $o"
done
# retention numbers
grep -q "180 days" docs/14-observability.md
grep -q "400 days" docs/14-observability.md
# SLO numbers appear
grep -q "95%"  docs/14-observability.md
grep -q "25 s" docs/14-observability.md
grep -q "60 s" docs/14-observability.md
# runbook sections
for r in "Import failing" "Auth broken" "RLS regressed"; do
  grep -q "$r" docs/14-observability.md || echo "missing runbook: $r"
done
```

All `grep` commands must succeed and the emoji check must produce no output.
