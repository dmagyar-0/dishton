# 14 — Observability

## Purpose

Define how Dishton sees itself once it is running: frontend error tracking
with Sentry (including source maps and import-flow breadcrumbs), backend
structured logging from Edge Functions drained to **Better Stack (Logtail)**,
an in-app AI cost dashboard backed by the Postgres view
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

> **Current posture (2026-06):** the view + owner-gated function exist in
> the schema, but there is NO `/admin/cost` UI route — cost inspection is
> a SQL query away (Dashboard → SQL editor →
> `select * from app.v_ai_daily_cost_for_household('<household>')`).
> Daily Anthropic spend alerting is handled at the provider: set a usage
> limit + email alert in the Anthropic console (see
> [runbooks/alerting.md](./runbooks/alerting.md)). The owner-facing chart
> and the 90%-of-budget banner described in earlier revisions are
> unbuilt roadmap items.

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
- `/home/user/dishton/src/routes/admin/cost.tsx` — owner-only AI cost
  dashboard route
- `/home/user/dishton/supabase/functions/_shared/log.ts`
- `/home/user/dishton/supabase/functions/_shared/sentry.ts`
- `/home/user/dishton/supabase/migrations/<ts>_v_ai_daily_cost.sql`
  (owned content-wise by [04-data-model.md](./04-data-model.md), shape
  fixed here)
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
      owners, and powers `/admin/cost` in the SPA.
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
grep -q "## Files this doc governs" docs/14-observability.md
grep -q "## Acceptance criteria"    docs/14-observability.md
grep -q "## Verification"           docs/14-observability.md
! grep -P '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]' docs/14-observability.md
# core nouns appear
for n in Sentry "Better Stack" "Logtail" v_ai_daily_cost \
         request_id profile_id ai_tokens_in ai_tokens_out; do
  grep -q "$n" docs/14-observability.md || echo "missing concept: $n"
done
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
