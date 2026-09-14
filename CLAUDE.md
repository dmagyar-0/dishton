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

  From the remote Claude-Code-on-the-web container a browser often **cannot**
  reach the deployed site: the agent proxy relays `curl` fine but drops
  Chromium's tunnels (`net::ERR_CONNECTION_RESET`, `ws_closed_mid_exchange` in
  `$HTTPS_PROXY/__agentproxy/status`), and the authenticated surfaces need
  production credentials this environment does not hold. When that happens, do
  not silently downgrade to "the local run passed". Do the checks that are
  still possible and state the gap:

  - `curl` the deployed page and its `/assets/*.js`, and grep the live bundle
    for markers of the change (new i18n keys, new element ids). That proves the
    code actually shipped, rather than inferring it from a green deploy.
  - Query the deployed database read-only for the runtime state the feature
    depends on.
  - Then say explicitly that visual confirmation is outstanding, and ask for a
    screenshot of the surface from someone who is signed in.
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
