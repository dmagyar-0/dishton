# CLAUDE.md

Dishton is a recipe-collection PWA. React + Vite SPA backed by Supabase (Postgres, Auth, Storage, Edge Functions). AI-powered recipe import runs in Edge Functions — **the browser never holds API keys**.

## Setup

Requires Node 22 (`.nvmrc`), pnpm 10+, Docker, and the `supabase` CLI.

```bash
pnpm install
supabase start              # Docker required
cp .env.example .env.local  # Fill from `supabase status`
pnpm db:reset               # Apply migrations + seed
pnpm dev                    # SPA at http://localhost:5173
pnpm fn:serve               # Edge Functions at http://localhost:54321 (no JWT verification)
```

Scripts live in `package.json`. `pnpm typecheck && pnpm lint` are the gates to run after a series of changes; test layers split as `test:unit` (domain), `test:components`, `test:edge` (Deno), `test:db` (RLS), `test:e2e` (Playwright).

## Architecture

- **`src/domain/`** — Zod schemas + pure business logic. **No React, no I/O.** Held to a 90% coverage threshold.
- **`src/ui/`** — React components grouped by feature (`recipe`, `search`, `shell`, `household`, `primitives`).
- **`src/routes/`** — TanStack Router file-based routes.
- **`src/lib/`** — Queries, forms, i18n, hooks.
- **`supabase/functions/`** — Deno Edge Functions. `_shared/domain` symlinks to `src/domain`.
- **`supabase/migrations/`** — SQL migrations. CI fails if a schema change ships without one.
- **`docs/`** — Authoritative source for locked decisions. Start at `docs/00-overview.md`.

### Frozen contracts (coordinate changes across SPA + Edge Functions)

1. Recipe Zod schema — `src/domain/recipe.ts`
2. SQL schema — `supabase/migrations/`
3. Design tokens — Tailwind config + Radix primitives

Formatting and lint are owned by Biome (`biome.json`) and enforced by `pnpm lint` — match the surrounding code rather than reasoning about the rules. `@/` resolves to `src/`.

## Testing

Vitest for the SPA, Deno test for Edge Functions and DB, Playwright for E2E. Co-locate component tests next to components; domain tests live under `src/domain/`.

- **Visual validation is required for any user-facing change** before claiming a feature complete. Run the `validating-features-visually` skill — it is authoritative for how, including inside the remote Claude-Code-on-the-web container (Docker daemon, Supabase CLI, and the `-x edge-runtime,functions` flag the sandbox needs). Typecheck and unit tests don't catch flash-of-wrong-content, mobile overflow, or wrong post-signup field population; merges #61, #62 and #63 each needed follow-up fixes for exactly that. Tooling not being up yet is not a reason to skip it — the skill documents the setup.
- **Verify on production after every deploy, with screenshots.** Local validation
  passing is not evidence the change works for real users: the local stack is
  seeded by `supabase/seed.sql`, which a deployed project never runs. #166
  shipped the whole "save a followed household's recipe" surface and every
  check was green — unit, DB, E2E and a full visual validation — while the
  feature was invisible in production, because `follows_enabled` only ever
  existed as a seeded row and `useFeatureFlag` reads a missing row as `false`
  (fixed in #167). The user found it on their phone, twice. So once the deploy
  lands: open the real site, reach the actual surface you changed, and capture
  screenshots at desktop and 390px — the same evidence bar the
  `validating-features-visually` skill sets locally. Check runtime state that
  the seed could be masking (`app.feature_flags` rows, migrations applied)
  directly against the deployed database, read-only.

  `scripts/verify-production.mjs` does all of this — run it, don't hand-roll it:

  ```bash
  node scripts/verify-production.mjs --marker <new-i18n-key>      # anonymous
  node --env-file=<creds> scripts/verify-production.mjs --authed \
    --marker save_link_action_to --out prod-verification          # signed in
  ```

  It fetches the deployed bundle and asserts your `--marker`s are really in it
  (proof the code shipped, not an inference from a green deploy), then drives
  the live site at desktop and 390px, screenshotting each state and failing on
  horizontal overflow or raw i18n keys. Two things it handles that a hand-rolled
  Playwright run gets wrong here:

  - **Chromium cannot reach the internet from this container.** The agent proxy
    relays Node's `fetch` fine but drops the browser's own tunnels
    (`net::ERR_CONNECTION_RESET`; `ws_closed_mid_exchange` in
    `$HTTPS_PROXY/__agentproxy/status`). The script intercepts every browser
    request and fulfils it from Node, so the page is still the real production
    app over the real network — only the transport differs.
  - **Production analytics are live.** `app.metrics_active_users` counts
    `distinct profile_id` from `app.analytics_events`, so a signed-in smoke run
    would show up as a real user in the admin dashboard. The script blocks that
    endpoint, leaving no metrics footprint. Pass `--keep-analytics` only if you
    deliberately want the writes.

  **Credentials.** A dedicated account exists for this —
  `prod-smoke@dishton.test` (profile `aaaaaaaa-0000-4000-8000-00000050c0de`),
  with a self-contained fixture it owns outright: household `Smoke Source
  Kitchen` holding the recipe `Smoke Test Lemonade`, followed by the smoke
  account's personal household. That exercises the followed-household browse and
  save surface without touching any real user's data. **No password is stored
  anywhere.** Reset it to a fresh random value at run time through the Supabase
  connector, write it to an env file in your scratchpad (never a command line,
  never the repo), and use `node --env-file`:

  ```sql
  update auth.users
     set encrypted_password = extensions.crypt('<fresh-random>', extensions.gen_salt('bf')),
         updated_at = now()
   where email = 'prod-smoke@dishton.test';
  ```

  If a check cannot be run at all, say so plainly rather than downgrading to
  "the local run passed".
- **Keep the `design-synch` skill current with the UI.** When you add a route, modal, dialog, or significant UI state, add a matching capture step to `.claude/skills/design-synch/capture.spec.ts` — a surface missing from that spec is silently missing from the design snapshot.

## Edge Functions (Deno)

- Secrets live in Supabase, not the repo: `supabase secrets set KEY=value`. Required: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `IG_OEMBED_TOKEN`, `LOG_DRAIN_TOKEN`.
- `supabase/functions/_shared/domain` is a symlink to `src/domain`. The deploy workflow replaces it with a real copy so Deno can resolve imports — don't break the symlink locally.
- Set `AI_MOCK_MODE=1` to stub AI calls during local testing.

## Repo etiquette

- Default branch is `main`. All CI checks (typecheck, lint, test suites, build, migration-diff) must pass before merge.
- Schema changes require a migration file in `supabase/migrations/` — enforced by the CI migration-diff check.
- Vercel is pinned to `vercel@53.2.0` in `.github/workflows/deploy.yml`; don't bump without verifying the koa transitive dep is published.

## Gotchas

- `src/routeTree.gen.ts` and `src/lib/database.types.ts` are generated. Don't hand-edit.
- PWA caching only kicks in on built output — test offline behavior via `pnpm preview`, not `pnpm dev`.
- Feature flags live in `src/feature-flags/` and gate behavior via `VITE_FEATURE_*` env vars.
- New deploys force session logout via `VITE_RELEASE_SHA` (set in CI, not locally).

## Skills

Two skills are installed under `.claude/skills/`, both Dishton-specific: `validating-features-visually` (required before calling a user-facing change complete) and `design-synch` (full UI snapshot for the design web app). The general-purpose superpowers process skills have been removed.
