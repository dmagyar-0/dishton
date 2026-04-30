# Parallelization Guide

## Purpose

Tell future sessions how to work on Dishton in parallel without colliding.
Restate the work-stream graph from the master plan, give a concrete recipe
for spinning up a `using-git-worktrees` worktree per stream, list each
tier's input docs / owned repo paths / done-criteria, name the three frozen
hand-off contracts (Zod `Recipe` schema, SQL schema, design tokens), and
enumerate the most likely collision risks plus how to avoid each. This doc
is the operations manual for "do N things at once and merge them cleanly".

## Prerequisites

- [00-overview.md](./00-overview.md) — locked decisions and tier order.
- [03-design-system.md](./03-design-system.md) — owns the design-token
  freeze contract.
- [04-data-model.md](./04-data-model.md) — owns the SQL schema freeze
  contract.
- [06-recipe-domain.md](./06-recipe-domain.md) — owns the Zod `Recipe`
  schema freeze contract.
- [13-ci-cd-and-environments.md](./13-ci-cd-and-environments.md) — branch
  policy and migration rules.

## Work-stream graph (expanded)

The graph from
`/root/.claude/plans/we-are-starting-a-giggly-goblet.md`, with each tier
annotated by which docs it consumes, which doc it produces, and the gating
contract that downstream tiers depend on.

```
            ┌──────────────────────────────────────┐
Tier 0      │ 00-overview / 01-architecture / 02   │  one session, sequential
            │ tech-stack                           │
            └──────────────────┬───────────────────┘
                               │  (locked decisions)
        ┌──────────────────────┼──────────────────────┐
        ▼                      ▼                      ▼
Tier 1  ┌───────────────┐ ┌────────────────┐ ┌──────────────────┐
        │ 03-design-    │ │ 04-data-model  │ │ 06-recipe-domain │
        │  system       │ │  (SQL + RLS)   │ │  (Zod, units,    │
        │ (tokens, type)│ │ (DDL frozen)   │ │   scaling)       │
        └──────┬────────┘ └────────┬───────┘ └────────┬─────────┘
               │                   │                  │
               │   ┌───────────────┴────────────┐     │
               │   ▼                            ▼     │
Tier 2         │ ┌──────────────┐    ┌──────────────┐ │
               │ │ 05-auth-and- │    │ 07-ai-       │◄┘
               │ │  households  │    │  integration │
               │ └──────┬───────┘    └──────┬───────┘
               │        │                   │
               │        │                   ▼
Tier 3         │        │           ┌────────────────┐
               │        │           │ 08-import-     │
               │        │           │   pipelines    │
               │        │           └──────┬─────────┘
               │        │                  │
               └────────┼──────────────────┤
                        ▼                  ▼
Tier 4              ┌────────────────┐  ┌────────────────┐
                    │ 09-recipe-     │  │ 10-search-     │
                    │   views        │  │   and-tags     │
                    └───────┬────────┘  └───────┬────────┘
                            │                   │
                            └─────────┬─────────┘
                                      ▼
Tier 5                    ┌──────────────────────┐
                          │ 11 / 12 / 13 / 14 / 15 │  cross-cutting
                          └──────────────────────┘
```

Same-tier streams can run in parallel because their owned paths are
disjoint and each consumes only docs from earlier tiers.

## Worktree recipe

Use the `using-git-worktrees` superpower for every parallel stream. The
naming convention is:

```
claude/dishton-stream-<tier><letter>
```

Examples: `claude/dishton-stream-1a` (design system),
`claude/dishton-stream-1b` (data model), `claude/dishton-stream-1c`
(recipe domain). Each worktree branches from the latest `main`.

Concrete commands (run from `/home/user/dishton`):

```bash
# 1. fetch the latest base
git fetch origin
git checkout main
git pull --ff-only

# 2. spin up a worktree per stream
git worktree add ../dishton-1a claude/dishton-stream-1a -b claude/dishton-stream-1a
git worktree add ../dishton-1b claude/dishton-stream-1b -b claude/dishton-stream-1b
git worktree add ../dishton-1c claude/dishton-stream-1c -b claude/dishton-stream-1c

# 3. each session works inside its own directory
cd ../dishton-1a   # session A
# ... commits, pushes ...

# 4. merge back, in tier order, fast-forward when possible
cd /home/user/dishton
git checkout main
git merge --ff-only origin/claude/dishton-stream-1a
git merge --ff-only origin/claude/dishton-stream-1b
git merge --ff-only origin/claude/dishton-stream-1c

# 5. clean up worktrees once branches merge
git worktree remove ../dishton-1a
git worktree remove ../dishton-1b
git worktree remove ../dishton-1c
```

Rules:

- One stream per worktree. Never reuse a worktree across streams.
- Each stream pushes its branch and opens a PR; merge order respects
  tier order in the graph above.
- Same-tier PRs may merge in any order between themselves provided their
  owned paths are disjoint (verified by `git diff --name-only main...`).
- Cross-tier PRs must wait for the predecessor tier to be merged to
  `main`, otherwise the contract referenced by the consumer may shift
  underfoot.

## Per-tier breakdown

For each tier, this section lists: streams, the docs each stream
consumes, the repo paths it owns (and may not touch outside of), and the
integration test that proves the stream is done.

### Tier 0 — Foundational (one session)

- **Stream 0** — produces docs `00`, `01`, `02`.
- Consumes: master plan only.
- Owns: `/home/user/dishton/docs/00-overview.md`,
  `/home/user/dishton/docs/01-architecture.md`,
  `/home/user/dishton/docs/02-tech-stack.md`,
  `/home/user/dishton/README.md`.
- Done test: `docs/00-overview.md` lists every doc in the tree and every
  locked decision from the plan; the verification block at the bottom
  passes.

### Tier 1 — Independent foundations (3 streams)

- **Stream 1a — design system.**
  - Consumes: docs `00`, `01`, `02`.
  - Owns: `docs/03-design-system.md`,
    `/home/user/dishton/src/ui/tokens/`,
    `/home/user/dishton/src/ui/primitives/` (skeletons),
    `/home/user/dishton/tailwind.config.ts`,
    `/home/user/dishton/src/styles/global.css`.
  - Done test: `pnpm test:components` passes for the primitives and
    Storybook (or equivalent token playground) renders every token
    swatch.

- **Stream 1b — data model.**
  - Consumes: docs `00`, `01`.
  - Owns: `docs/04-data-model.md`,
    `/home/user/dishton/supabase/migrations/`,
    `/home/user/dishton/supabase/seed.sql`,
    `/home/user/dishton/supabase/tests/schema.test.sql`,
    `/home/user/dishton/supabase/tests/rls.test.sql`,
    `/home/user/dishton/supabase/tests/run.ts`.
  - Done test: `pnpm test:db` against `supabase start` passes the schema
    and RLS suites.

- **Stream 1c — recipe domain.**
  - Consumes: docs `00`, `02`.
  - Owns: `docs/06-recipe-domain.md`,
    `/home/user/dishton/src/domain/`.
  - Done test: `pnpm test:unit` passes with 90% coverage on
    `src/domain/**`.

### Tier 2 — Wiring (2 streams)

- **Stream 2a — auth and households.**
  - Consumes: `03`, `04`.
  - Owns: `docs/05-auth-and-households.md`,
    `/home/user/dishton/src/auth/`,
    `/home/user/dishton/src/routes/(auth)/`,
    `/home/user/dishton/src/routes/(onboarding)/`,
    `/home/user/dishton/src/features/households/`.
  - Done test: Playwright spec subset
    `e2e/smoke.spec.ts::auth-and-household` passes (signup → create
    household).

- **Stream 2b — AI integration.**
  - Consumes: `06`.
  - Owns: `docs/07-ai-integration.md`,
    `/home/user/dishton/supabase/functions/_shared/nim.ts`,
    `/home/user/dishton/supabase/functions/_shared/prompts/`.
  - Done test: `pnpm test:edge` passes for shared NIM client tests with
    `MockFetch`.

### Tier 3 — Imports (1 stream)

- **Stream 3 — import pipelines.**
  - Consumes: `04`, `06`, `07`.
  - Owns: `docs/08-import-pipelines.md`,
    `/home/user/dishton/supabase/functions/import-url/`,
    `/home/user/dishton/supabase/functions/import-instagram/`,
    `/home/user/dishton/supabase/functions/import-photo/`,
    `/home/user/dishton/supabase/functions/translate-recipe/`,
    `/home/user/dishton/src/features/import/`.
  - Done test: each Edge Function's `*_test.ts` passes; SPA import panel
    renders all four tabs.

### Tier 4 — Reading (2 streams)

- **Stream 4a — recipe views.**
  - Consumes: `03`, `05`, `06`, `08`.
  - Owns: `docs/09-recipe-views.md`,
    `/home/user/dishton/src/features/recipes/`,
    `/home/user/dishton/src/routes/recipes/`.
  - Done test: `RecipeDetail.test.tsx`, `RecipeList.test.tsx`,
    `RecipeImportPanel.test.tsx` pass; smoke E2E view + scale + toggle
    steps pass.

- **Stream 4b — search and tags.**
  - Consumes: `04`, `06`.
  - Owns: `docs/10-search-and-tags.md`,
    `/home/user/dishton/src/features/search/`,
    `/home/user/dishton/src/routes/search/`,
    a migration adding the `tsvector` column and index.
  - Done test: a Vitest spec for the FTS query builder; a `pnpm test:db`
    case asserting the GIN index exists; component tests for the search
    box.

### Tier 5 — Cross-cutting (one session)

- **Stream 5** — produces docs `11`, `12`, `13`, `14`, `15`,
  `parallelization-guide.md`.
- Consumes: every earlier doc.
- Owns: `/home/user/dishton/.github/workflows/`,
  `/home/user/dishton/playwright.config.ts`,
  `/home/user/dishton/vitest.config.ts`,
  `/home/user/dishton/src/observability/`,
  `/home/user/dishton/src/feature-flags/`,
  service-worker + manifest files.
- Done test: `pnpm test` runs every layer and exits 0; CI workflows are
  green on a sample PR.

## Hand-off contracts (frozen interfaces)

Three artifacts are the published interfaces between streams. Once the
authoring stream merges to `main`, the artifact is frozen: any change
requires a coordination round (a follow-up PR that explicitly updates
every consumer in the same merge window).

1. **Zod `Recipe` schema** — exported from
   `/home/user/dishton/src/domain/recipe.ts`. Owned by stream 1c (doc
   `06`). Consumed by 2b (AI prompts), 3 (import pipelines), 4a (recipe
   views), 4b (search shape), 5 (testing fixtures). Changes require a
   migration + edge-function redeploy + SPA rebuild.
2. **SQL schema** — every table, column, RLS policy, and index in
   `/home/user/dishton/supabase/migrations/`. Owned by stream 1b (doc
   `04`). Consumed by everything that reads or writes Postgres.
   Forward-only per
   [13-ci-cd-and-environments.md](./13-ci-cd-and-environments.md).
3. **Design tokens** — files under
   `/home/user/dishton/src/ui/tokens/` and the Tailwind theme extension
   in `tailwind.config.ts`. Owned by stream 1a (doc `03`). Consumed by
   every UI-touching stream.

A change to any of the three:

- Lands in a single PR that includes all consumer updates.
- Bumps the file's leading docstring version (e.g. `// schema v3`).
- Triggers the full CI matrix; PRs that update only some consumers are
  rejected at review.

## Common collision risks

The pairs below are the most likely to step on each other. Each row
names the risk and the rule that prevents it.

| Risk | Streams involved | Rule |
|---|---|---|
| Two streams add a top-level route in `src/main.tsx` | any UI streams | `src/main.tsx` is owned by stream 5 (cross-cutting). UI streams add file-based routes under `src/routes/` only — TanStack Router auto-discovers them. |
| Two streams add overlapping migrations | 1b, 3, 4b | Migrations are timestamp-prefixed; concurrent streams must rebase to ensure timestamp order matches merge order. The `migration-diff` CI job from doc 13 catches drift. |
| Two streams edit the same Tailwind config | 1a, 4a | Only stream 1a edits `tailwind.config.ts`. Other streams use existing tokens; if a token is missing, file an issue against stream 1a. |
| Two streams import the Zod `Recipe` shape and want to add a field | 2b, 3, 4a | Field additions land in stream 1c first, behind a default value, before any consumer ships. |
| Two streams add Edge Functions with shared utilities | 2b, 3 | The `supabase/functions/_shared/` directory is owned by stream 2b. Stream 3 may add files there only via PR review with stream 2b. |
| Two streams add npm dependencies that conflict on peer ranges | any | Dependency adds always update `package.json` plus `pnpm-lock.yaml` in the same PR; the CI `lint` job runs `pnpm install --frozen-lockfile` and fails on lock drift. |
| E2E tests written by stream 4a clash with infra changes from stream 5 | 4a, 5 | `e2e/` directory is owned by stream 5; stream 4a writes scenario specs but only stream 5 changes the Playwright config or fixture server. |
| Feature flag added in code without registry entry | any | The CI flag-registry check from
[15-roadmap-and-flags.md](./15-roadmap-and-flags.md) fails the build until the registry entry exists. |
| Two streams seed conflicting rows into `app.feature_flags` | 1b, 5 | Stream 1b owns the table DDL, stream 5 owns `seed.sql` rows. Stream 1b only seeds rows that the table itself requires; product-level flag rows live in stream 5's seed pass. |

When in doubt: check the "Owns" list for your tier above. If you would
edit a path outside it, stop and either re-scope your stream or open a
coordination PR against the owning stream first.

## Files this doc governs

- `/home/user/dishton/docs/parallelization-guide.md`
- This doc itself does not own any source paths; it documents the
  ownership rules enforced by the tier breakdown. CI scripts that
  verify ownership live with stream 5 in `/home/user/dishton/scripts/`
  (e.g. `scripts/check-ownership.ts` greps PR diffs for paths outside
  the declared stream's `Owns` list when run with
  `--stream=<id>`).

## Acceptance criteria

- [ ] The work-stream graph in this doc matches the tiers in
      [00-overview.md](./00-overview.md) and the master plan.
- [ ] Every tier lists its streams with consumed docs, owned paths, and
      a concrete done test.
- [ ] All three frozen contracts (Zod `Recipe`, SQL schema, design
      tokens) are named with absolute repo paths and owning streams.
- [ ] Worktree naming convention is `claude/dishton-stream-<id>` and
      example commands are present.
- [ ] At least eight collision risks are listed with a preventive rule
      each.
- [ ] No emoji anywhere in the file.

## Verification

Run from `/home/user/dishton`:

```bash
test -f docs/parallelization-guide.md
grep -q "## Purpose"                docs/parallelization-guide.md
grep -q "## Prerequisites"          docs/parallelization-guide.md
grep -q "## Files this doc governs" docs/parallelization-guide.md
grep -q "## Acceptance criteria"    docs/parallelization-guide.md
grep -q "## Verification"           docs/parallelization-guide.md
! grep -P '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]' docs/parallelization-guide.md
# every tier named
for t in "Tier 0" "Tier 1" "Tier 2" "Tier 3" "Tier 4" "Tier 5"; do
  grep -q "$t" docs/parallelization-guide.md || echo "missing tier: $t"
done
# frozen contracts
for c in "Zod" "SQL schema" "design tokens"; do
  grep -q "$c" docs/parallelization-guide.md || echo "missing contract: $c"
done
# worktree naming convention
grep -q "claude/dishton-stream-" docs/parallelization-guide.md
# at least 8 collision rows (table rows start with '|')
test "$(grep -cE '^\| ' docs/parallelization-guide.md)" -ge 8
```

All `grep` commands must succeed and the emoji check must produce no output.
