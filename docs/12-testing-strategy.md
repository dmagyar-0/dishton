# 12 — Testing Strategy

## Purpose

Define the test pyramid for Dishton so that every change ships with the right
flavour of automated coverage. The non-negotiable safety net is `src/domain/*`
(unit conversion, scaling, fraction rounding) — humans cook from this code, so
those modules are tested exhaustively. Around that core sit component tests for
UI primitives and recipe screens, Edge Function tests with Anthropic mocked,
a Supabase test harness that asserts schema and RLS, and a tight Playwright
smoke covering the end-to-end import → view → scale → toggle flow. This doc
specifies which tooling is used, where each test type lives, the coverage
targets, and how the suites are wired into CI.

## Prerequisites

- [00-overview.md](./00-overview.md) — locked tooling (Vitest, Playwright, pnpm).
- [01-architecture.md](./01-architecture.md) — process boundaries (SPA vs Edge
  Function vs Postgres) so each layer is tested in the right place.
- [02-tech-stack.md](./02-tech-stack.md) — Vitest + Testing Library + Playwright
  versions and Biome config.
- [04-data-model.md](./04-data-model.md) — DDL and RLS policies asserted by
  `pnpm test:db`.
- [06-recipe-domain.md](./06-recipe-domain.md) — Zod schemas, unit graph, and
  scaling rules under exhaustive Vitest cover.
- [07-ai-integration.md](./07-ai-integration.md) — Anthropic client signature
  that Edge Function tests mock via `MockFetch`.

## Test pyramid

```
                ┌──────────────────────┐
                │  E2E (Playwright)    │   1 smoke flow
                ├──────────────────────┤
                │  Edge Function tests │   per function, Anthropic mocked
                │  Supabase harness    │   DDL + RLS assertions
                ├──────────────────────┤
                │  Component tests     │   primitives + key screens
                ├──────────────────────┤
                │  Domain unit tests   │   exhaustive (>= 90% lines)
                └──────────────────────┘
```

The shape is intentional: a wide unit base on `src/domain/*` (cheap, fast,
deterministic), a deliberate middle layer that protects the contracts between
SPA and Supabase, and a single Playwright happy path that proves the system
boots end to end.

## Layer 1 — Domain unit tests (Vitest)

Scope: every module under `/home/user/dishton/src/domain/`. This includes the
canonical Zod schema, unit graph (`convert-units` + cooking extensions), the
fraction-rounding helper ("nice fractions"), and the scaling functions.

Rules:

- One `*.test.ts` co-located with each source file. No `__tests__` directories.
- Pure-function tests only. No DOM, no network, no Supabase client. If a test
  needs any of those, it belongs in another layer.
- Property-based tests via `fast-check` for `scale()` and unit conversion: every
  invariant in [06-recipe-domain.md](./06-recipe-domain.md) (idempotence under
  scale-then-unscale, commutativity of unit then scale, etc.) is encoded as a
  property test.
- Snapshot tests are forbidden in this layer. Use explicit assertions.
- Coverage target: **90% lines, 90% branches, 90% functions** on
  `src/domain/**`. Below this, CI fails. Configured in `vitest.config.ts` via
  `coverage.thresholds`.

Required test suites:

| File under `src/domain/` | Required cases |
|---|---|
| `recipe.ts` (Zod schema) | every required field, every enum, JSON round-trip, rejection of malformed payloads |
| `units/graph.ts` | full cross-product metric ↔ imperial for mass, volume, temperature, length; rejected unit pairs throw |
| `units/cooking.ts` | cup ↔ ml, tbsp ↔ ml, tsp ↔ ml, stick of butter ↔ g, "pinch", "dash" |
| `scale.ts` | integer factors (2x, 4x), fractional factors (1.5x, 0.5x, 1/3), serving-target rounding, ingredient-quantity preservation when `scaleable=false` |
| `fractions.ts` | rounding to 1/8 grid, hiding fractions on quantities >= 10, mixed-number rendering |
| `language.ts` | locale fallback chain, BCP-47 normalisation |

Run locally:

```bash
pnpm test:unit            # vitest run --project domain
pnpm test:unit --watch    # interactive
pnpm test:coverage        # writes coverage/ and enforces 90% domain threshold
```

## Layer 2 — Component tests (Vitest + Testing Library)

Scope: `/home/user/dishton/src/ui/primitives/**` and the three load-bearing
recipe screens listed below. Tests use `@testing-library/react` and
`@testing-library/user-event`. JSDOM environment is configured per-file via
`/* @vitest-environment jsdom */`.

Co-located `*.test.tsx` files. No global test setup beyond `vitest.setup.ts`
which:

- registers `@testing-library/jest-dom` matchers,
- mocks `matchMedia` and `IntersectionObserver`,
- mounts the i18next test instance with the `en` and `de` bundles.

Required component suites:

- Every primitive in `src/ui/primitives/` ships with a sibling `.test.tsx`
  that asserts: render with default props, ARIA role/label, keyboard
  interaction (Enter / Space / Esc as applicable), and `prefers-reduced-motion`
  branch when motion is involved.
- Recipe screens that must have component tests (mocked data, no router):
  - `src/ui/recipe/RecipeDetail.test.tsx` — renders ingredients, steps, hero
    image, scale slider, unit toggle, language toggle.
  - `src/ui/recipe/RecipeList.test.tsx` — empty state, populated state, follow
    indicator on followed-household cards.
  - `src/ui/recipe/RecipeImportPanel.test.tsx` — URL/Instagram/photo/manual
    tabs, error states, draft-review handoff.

Coverage target: **no hard threshold on `src/ui/**`** because component tests
are about behaviour, not lines. Overall repo coverage must still hit 70%
(see "Coverage targets" below).

Run locally:

```bash
pnpm test:components       # vitest run --project components
```

## Layer 3 — Edge Function tests (Deno test runner)

Scope: every Deno function under `/home/user/dishton/supabase/functions/*`.
Each function has a sibling `*_test.ts` (Deno convention).

Anthropic and any other outbound `fetch` is mocked via a small `MockFetch`
helper at `supabase/functions/_shared/mock_fetch.ts`. The helper installs a
typed handler over `globalThis.fetch`, asserts the request URL, headers, and
JSON body, and returns a canned response. Every test must restore `fetch` via
`using` so leaks across tests are impossible.

Required cases per function:

- `import-url`: happy path (HTML fixture → JSON-LD + lightStripHtml → Anthropic JSON →
  Zod-valid draft); Anthropic returns malformed JSON, function re-prompts
  once; second failure surfaces a typed error to the SPA; rate-budget
  exhausted returns `429`.
- `import-instagram`: oEmbed 200 happy path; oEmbed 404; private post.
- `import-photo`: vision happy path with a tiny PNG fixture (base64);
  Anthropic image-too-large error; profanity-filter rejection.
- `translate-recipe`: cache hit short-circuit; cache miss writes
  `recipe_translations`; identical source/target language returns input.
- `convert-units`: optional helper, asserted to match `src/domain/units/`
  outputs for the same inputs (parity test).

Run locally:

```bash
pnpm test:edge             # wraps: deno test -A supabase/functions
```

## Layer 4 — Supabase test harness (DDL + RLS)

Scope: the SQL schema and RLS policies defined in
[04-data-model.md](./04-data-model.md). The harness uses the local Supabase
stack (`supabase start`) plus a small `pgtap`-style test runner script.

Files:

- `/home/user/dishton/supabase/tests/schema.test.sql` — asserts every table,
  column type, FK, and index from doc 04.
- `/home/user/dishton/supabase/tests/rls.test.sql` — for each role
  (`anon`, `authenticated` as profile A, profile B in same household, profile
  C in a following household, profile D unrelated) asserts read and write
  outcomes against `recipes`, `recipe_ingredients`, `recipe_steps`,
  `households`, `household_members`, `follows`, `import_jobs`.
- `/home/user/dishton/supabase/tests/run.ts` — Deno script that:
  1. assumes `supabase start` is running on the conventional ports,
  2. resets the DB via `supabase db reset --no-seed`,
  3. applies migrations,
  4. runs each `*.test.sql` file inside a transaction that rolls back at the
     end, and prints `ok N - <name>` or `not ok N - <name>` lines (TAP).

Run locally (requires Docker):

```bash
supabase start
pnpm test:db               # wraps: deno run -A supabase/tests/run.ts
```

`pnpm test:db` exits non-zero if any assertion fails. CI uses the same
command (see [13-ci-cd-and-environments.md](./13-ci-cd-and-environments.md)).

## Layer 5 — Playwright smoke E2E

Scope: a single happy-path scenario that exercises the full stack with the
Anthropic API mocked at the Edge Function boundary. Anything more elaborate belongs in
the component or unit layer.

Location: `/home/user/dishton/e2e/`.

- `e2e/playwright.config.ts` — three browsers? no. Chromium only on CI; add
  `--project=webkit` locally if needed. Base URL points at the Vite preview
  server started by the `webServer` block.
- `e2e/fixtures/` — recipe HTML fixture, AI canned response, image fixture.
- `e2e/smoke.spec.ts` — the scenario.

Required scenario steps (one test, in order):

1. Visit `/`, sign up with a fresh email + password (uses Supabase local).
2. Land on the "create or join household" screen; create household
   "Test Kitchen".
3. Navigate to import; paste a fixture URL pointing at the local fixture
   server.
4. The Edge Function returns the canned AI draft (test sets the
   `AI_MOCK_MODE=playwright` flag so the function reads from
   `e2e/fixtures/ai-draft.json` instead of calling the real API).
5. Approve the draft; confirm the recipe detail page renders the title,
   ingredients, and steps.
6. Move the scale slider to "4 servings"; assert at least one ingredient
   quantity changes and the new value matches the scaling rule from
   [06-recipe-domain.md](./06-recipe-domain.md).
7. Toggle units from metric to imperial; assert the displayed unit symbols
   change and the numeric value matches the conversion rule.
8. Toggle display language from `en` to `de`; assert the cached translation
   row was created in `recipe_translations` (queried via the Supabase test
   client) and the rendered title is the translated string.

Run locally:

```bash
pnpm test:e2e              # wraps: playwright test
pnpm test:e2e --ui         # interactive runner
```

## Coverage targets

| Scope | Tool | Threshold | Enforced where |
|---|---|---|---|
| `src/domain/**` | Vitest v8 coverage | 90% lines / 90% branches / 90% functions | `vitest.config.ts` thresholds |
| Repo overall (excluding `src/ui/**`, `e2e/**`, generated files) | Vitest v8 coverage | 70% lines | `vitest.config.ts` thresholds |
| `src/ui/**` | n/a | no target | n/a |
| Edge Functions | Deno coverage | not enforced; reported only | `pnpm test:edge --coverage` artifact in CI |

## Test file conventions

| Where | Pattern | Runner |
|---|---|---|
| `src/domain/**/*.test.ts` | co-located, no JSX | Vitest, node env |
| `src/ui/**/*.test.tsx` | co-located, JSX | Vitest, jsdom env |
| `supabase/functions/**/*_test.ts` | co-located, Deno | `deno test` |
| `supabase/tests/*.test.sql` | central | `supabase/tests/run.ts` |
| `e2e/**/*.spec.ts` | central, isolated | Playwright |

`pnpm test` runs every layer in order: unit → components → edge → db → e2e.
Each subcommand can be invoked independently for fast iteration.

## CI integration

Wiring lives in [13-ci-cd-and-environments.md](./13-ci-cd-and-environments.md).
The summary:

- `ci.yml` runs `pnpm test:unit`, `pnpm test:components`, and
  `pnpm test:coverage` on every PR. Coverage thresholds are enforced here.
- `ci.yml` also runs `pnpm test:edge` (Deno installed via the official action)
  and `pnpm test:db` after starting the local Supabase stack.
- `e2e.yml` runs `pnpm test:e2e` against a Vercel preview deployment of the
  PR branch. Anthropic is mocked via the same `AI_MOCK_MODE=playwright`
  flag so the preview never calls the live Anthropic API during tests.
- A failing test at any layer blocks merge to `main`.

## Files this doc governs

- `/home/user/dishton/vitest.config.ts`
- `/home/user/dishton/vitest.setup.ts`
- `/home/user/dishton/playwright.config.ts`
- `/home/user/dishton/e2e/**`
- `/home/user/dishton/src/domain/**/*.test.ts`
- `/home/user/dishton/src/ui/**/*.test.tsx`
- `/home/user/dishton/supabase/functions/**/*_test.ts`
- `/home/user/dishton/supabase/functions/_shared/mock_fetch.ts`
- `/home/user/dishton/supabase/tests/schema.test.sql`
- `/home/user/dishton/supabase/tests/rls.test.sql`
- `/home/user/dishton/supabase/tests/run.ts`
- `package.json` scripts: `test`, `test:unit`, `test:components`,
  `test:coverage`, `test:edge`, `test:db`, `test:e2e`.

## Acceptance criteria

- [ ] `pnpm test:unit` runs every `src/domain/**/*.test.ts` and exits 0 on a
      clean checkout once doc 06 is implemented.
- [ ] `pnpm test:coverage` enforces 90% on `src/domain/**` and 70% overall
      and fails the build below either threshold.
- [ ] Every primitive in `src/ui/primitives/` has a sibling `.test.tsx`
      asserting role, keyboard, and reduced-motion behaviour.
- [ ] `RecipeDetail.test.tsx`, `RecipeList.test.tsx`, and
      `RecipeImportPanel.test.tsx` exist with the cases listed above.
- [ ] Each Edge Function has a sibling `*_test.ts` exercising happy path,
      one Anthropic failure mode, and one rate-limit case via `MockFetch`.
- [ ] `pnpm test:db` runs DDL and RLS assertions against a local Supabase
      stack and exits non-zero on any failure.
- [ ] `e2e/smoke.spec.ts` covers signup → household → URL import (Anthropic
      mocked) → recipe view → scale to 4 servings → unit toggle → language
      toggle and passes against a fresh local stack.
- [ ] `pnpm test` runs all five layers sequentially.
- [ ] No test calls the live Anthropic API. CI greps for
      `api.anthropic.com` outside of `supabase/functions/**` and
      `docs/**` and fails if found in test files.
- [ ] No emoji anywhere in this doc.

## Verification

Run from `/home/user/dishton`:

```bash
test -f docs/12-testing-strategy.md
grep -q "## Purpose"                docs/12-testing-strategy.md
grep -q "## Prerequisites"          docs/12-testing-strategy.md
grep -q "## Files this doc governs" docs/12-testing-strategy.md
grep -q "## Acceptance criteria"    docs/12-testing-strategy.md
grep -q "## Verification"           docs/12-testing-strategy.md
! grep -P '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]' docs/12-testing-strategy.md
# every promised script name is mentioned
for s in test:unit test:components test:coverage test:edge test:db test:e2e; do
  grep -q "$s" docs/12-testing-strategy.md || echo "missing script: $s"
done
# cross-links to dependent docs
for d in 00-overview 01-architecture 02-tech-stack 04-data-model \
         06-recipe-domain 07-ai-integration 13-ci-cd-and-environments; do
  grep -q "$d" docs/12-testing-strategy.md || echo "missing link: $d"
done
```

All `grep` commands must succeed and the emoji check must produce no output.
