# Alerting

What pages a human, where it is configured, and the exact queries. The
repo can only emit signals; every alert below is dashboard-side
configuration that must exist in production. Verify each one when
touching observability.

## Signals the code emits

- **Edge Functions** log one structured JSON line per event to stdout
  (`_shared/log.ts`); Supabase forwards stdout to the configured log
  drain (Better Stack / Logtail). Error shape: `level=error`,
  `event=request.error`, plus `function`, `request_id`.
- **AI calls** log `kind=ai_call` lines with `ok`, `tokens_in/out`,
  `model`, `ms`.
- **Frontend** ships errors (and error-sampled replays) to Sentry via
  `VITE_SENTRY_DSN_FRONTEND` with release = deploy SHA.
- **Deploys** fail loudly in GitHub Actions (deploy.yml is CI-gated,
  serialized, and ends with a smoke probe of the shipped URL).

## Required dashboard-side alerts

| Alert | Where | Rule |
|---|---|---|
| Edge Function errors | Better Stack | `level=error AND event=request.error` — threshold ≥3 in 15 min → email/push |
| AI failures | Better Stack | `kind=ai_call AND ok=false` — threshold ≥5 in 30 min (catches Anthropic outages and schema drift) |
| Import success collapse | Better Stack | `event=request.needs_review OR event=rate_budget.deny` spike vs baseline |
| Frontend error spike | Sentry | default issue-alert: new issue OR >20 events/h → email |
| Anthropic spend | Anthropic console | monthly usage limit + email at 80% (the in-app budgets cap per-minute burst, not monthly spend) |
| Deploy failure | GitHub | Actions failure notifications for deploy.yml (watch the repo, "Actions" enabled) |

Setup pointers:

- The log drain itself is configured in Supabase Dashboard → Project
  Settings → Log Drains (token lives there; `LOG_DRAIN_TOKEN` in
  `.env.example` documents the secret's existence, the functions do not
  read it).
- Better Stack alerts: Logs → Saved queries → save each query above →
  attach an alert policy.

## Verification checklist (run after changing any of this)

1. Trigger a synthetic Edge Function error (call `import-url` with an
   unreachable URL against production) and confirm the log line reaches
   the drain and the alert fires.
2. Throw a test error in the SPA (`Sentry.captureException`) on a preview
   build and confirm the Sentry alert path.
3. Confirm the Anthropic console limit is set for the current month.

## Known gaps (roadmap, not shipped)

- No `@sentry/deno` in Edge Functions — stack traces live only in the
  drain (see docs/14 "Current posture").
- No SLO snapshots / burn-rate automation; targets in docs/14 are read
  manually.
- No paging integration (this is a side project — email/push is the
  agreed ceiling for now).
