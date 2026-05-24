# CLAUDE.md

Dishton is a recipe-collection PWA. React + Vite SPA backed by Supabase (Postgres, Auth, Storage, Edge Functions). AI-powered recipe import runs in Edge Functions — **the browser never holds API keys**.

## Setup

```bash
pnpm install
supabase start              # Docker required; runs Postgres, Auth, Storage, Edge Functions
cp .env.example .env.local  # Fill from `supabase status`
pnpm db:reset               # Apply migrations + seed
pnpm dev                    # SPA at http://localhost:5173
pnpm fn:serve               # Edge Functions at http://localhost:54321 (no JWT verification)
```

Requires Node 22 (`.nvmrc`), pnpm 10+, Docker, and the `supabase` CLI.

## Commands

| Task | Command |
|------|---------|
| Typecheck | `pnpm typecheck` |
| Lint / format | `pnpm lint` / `pnpm format` (Biome) |
| Unit tests (domain) | `pnpm test:unit` |
| Component tests | `pnpm test:components` |
| Coverage | `pnpm test:coverage` |
| Edge Function tests (Deno) | `pnpm test:edge` |
| DB schema + RLS tests | `pnpm test:db` |
| E2E (Playwright) | `pnpm test:e2e` |
| Build | `pnpm build` |
| Deploy Edge Functions | `pnpm fn:deploy` |

Prefer a single test file over the whole suite during iteration. Run `pnpm typecheck && pnpm lint` after a series of changes.

## Architecture

- **`src/domain/`** — Zod schemas + pure business logic. **No React, no I/O.** Coverage threshold: 90%.
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

## Code style

- Biome enforces formatting and lint (`biome.json`): 2 spaces, 100-col width, single quotes, semicolons, trailing commas.
- TypeScript is strict with `noUncheckedIndexedAccess`. Use `import type` for type-only imports.
- Path alias `@/` resolves to `src/`.
- Avoid `any` and non-null assertions (`!`) — Biome warns on both.

## Testing

- Vitest for SPA (unit + components), Deno test for Edge Functions and DB, Playwright for E2E.
- Coverage thresholds: domain 90% lines/branches/functions; overall 70% lines.
- Co-locate component tests next to components. Domain tests live under `src/domain/`.
- **Visual validation is required for any user-facing change** before claiming a feature complete. Run the `validating-features-visually` skill — it boots a local Supabase + `pnpm preview`, drives Playwright through signup + the new flow + adjacent surfaces at desktop and mobile viewports, and screenshots each step. Typecheck and unit tests don't catch flash-of-wrong-content, mobile overflow, or wrong post-signup field population — recent merges (#61, #62, #63) all needed follow-up fixes for exactly this class of bug.

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

## Superpowers skills

Skills are installed under `.claude/skills/` (from [obra/superpowers](https://github.com/obra/superpowers) and [anthropics/skills](https://github.com/anthropics/skills), MIT). **At session start, invoke `using-superpowers` via the `Skill` tool.** Prefer matching a skill over improvising.

Available: `using-superpowers`, `brainstorming`, `writing-plans`, `executing-plans`, `test-driven-development`, `systematic-debugging`, `verification-before-completion`, `validating-features-visually`, `requesting-code-review`, `receiving-code-review`, `dispatching-parallel-agents`, `subagent-driven-development`, `using-git-worktrees`, `finishing-a-development-branch`, `writing-skills`, `frontend-design`.
