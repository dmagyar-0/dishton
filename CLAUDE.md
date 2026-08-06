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
